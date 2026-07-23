"""
Agent 编排 API — 工作流启动、进度流、结果查询、历史管理。

提供：
- POST /start — 异步启动工作流
- GET /{id}/progress — SSE 实时进度推送
- GET /{id}/result — 获取最终结果
- GET /workflows — 历史列表
- DELETE /{id} — 删除记录
"""

from __future__ import annotations

import json
import time
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.models.database import get_db
from app.models.schemas import APIResponse

router = APIRouter(prefix="/api/agent", tags=["Agent编排"])


# ── 工作流类型列表 ──────────────────────────────────────

@router.get("/workflows/types", response_model=APIResponse)
async def list_workflow_types():
    """获取所有预置工作流类型及其参数定义。"""
    from app.services.agent_service import WORKFLOW_REGISTRY
    return APIResponse(success=True, data={"types": list(WORKFLOW_REGISTRY.values())})


# ── 启动工作流 ──────────────────────────────────────────

@router.post("/workflow/start", response_model=APIResponse)
async def start_workflow(request: Request):
    """异步启动一个 Agent 编排工作流。

    请求体：
        workflow_type: str — 工作流类型（class_diagnosis / lesson_to_exam / branch_grading）
        params: dict — 参数（course_name, chapter, knowledge_points 等）

    返回 workflow_id，前端通过 /progress 轮询进度或 SSE 实时监听。
    """
    body = await request.json()
    workflow_type = body.get("workflow_type", "")
    params = body.get("params", {})

    if not workflow_type:
        raise HTTPException(status_code=400, detail="请指定 workflow_type")

    # ── 显式解析 LLM 配置并注入到 params ──
    # 直接从请求头读取，绕过 ContextVar 跨线程传播问题
    api_key = request.headers.get("X-LLM-Api-Key", "")
    base_url = request.headers.get("X-LLM-Base-Url", "")
    model_name = request.headers.get("X-LLM-Model-Name", "")

    # 如果请求头没有，回退到供应商存储
    if not api_key:
        from app.core.llm import get_active_provider
        active = get_active_provider()
        if active:
            base_url = base_url or active.get("base_url", "")
            models = active.get("models", [])
            if models:
                default_model = next((m for m in models if m.get("is_default")), models[0])
                api_key = default_model.get("api_key", "")
                model_name = model_name or default_model.get("model_name", "")
            if not api_key:
                api_key = active.get("api_key", "")

    import logging
    _logger = logging.getLogger(__name__)
    _logger.info(f"[Agent启动] API Key 解析: has_key={bool(api_key)}, model={model_name or 'unknown'}, base_url={base_url[:50] if base_url else 'empty'}")

    params["_llm_api_key"] = api_key
    params["_llm_base_url"] = base_url
    params["_llm_model_name"] = model_name

    from app.services.agent_service import (
        create_workflow, run_workflow_async, store_workflow,
    )

    try:
        workflow, initial_input = create_workflow(workflow_type, params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 进度回调：实时更新数据库
    def on_progress(progress):
        try:
            store_workflow(workflow)
        except Exception:
            pass

    # 完成回调
    def on_complete(result):
        store_workflow(workflow)

    # 异步执行
    run_workflow_async(workflow, initial_input, on_complete, on_progress)
    # 立即保存初始状态
    store_workflow(workflow)

    return APIResponse(success=True, message=f"工作流「{workflow.name}」已启动",
                       data={"workflow_id": workflow.id, "type": workflow_type, "status": "running"})


# ── SSE 实时进度 ────────────────────────────────────────

@router.get("/workflow/{workflow_id}/progress")
async def stream_progress(workflow_id: str):
    """通过 SSE (Server-Sent Events) 实时推送工作流执行进度。

    前端使用 EventSource 连接此端点，接收 step_start / step_complete / workflow_done 事件。
    """
    from app.services.agent_service import _active_workflows

    workflow = _active_workflows.get(workflow_id)
    if not workflow:
        # 已完成的从数据库读取
        from app.services.agent_service import get_workflow_result
        result = get_workflow_result(workflow_id)
        if not result:
            raise HTTPException(status_code=404, detail="工作流不存在")
        # 返回已完成状态
        def done_gen():
            yield f"data: {json.dumps({'event': 'workflow_done', 'status': result.get('status', 'completed'), 'result': result}, ensure_ascii=False)}\n\n"
        return StreamingResponse(done_gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    def event_stream():
        q = workflow.get_progress_queue()
        sent_done = False
        empty_count = 0
        max_empty = 120  # 最多等待 120 秒

        while not sent_done and empty_count < max_empty:
            try:
                progress = q.get(timeout=0.5)
                empty_count = 0
                event_data = json.dumps({
                    "event": "step_update",
                    "step_index": progress.step_index,
                    "step_name": progress.step_name,
                    "status": progress.status,
                    "summary": progress.summary,
                    "output_preview": progress.output_preview,
                }, ensure_ascii=False)
                yield f"data: {event_data}\n\n"

                if progress.step_index < 0 and progress.status == "completed":
                    # 这是分支选择事件
                    pass
            except Exception:
                empty_count += 1
                # 检查工作流是否已完成
                wf = _active_workflows.get(workflow_id)
                if wf and wf.status.value in ("completed", "failed"):
                    break
                time.sleep(0.5)

        # 发送完成事件
        from app.services.agent_service import get_workflow_result
        result = get_workflow_result(workflow_id) or {}
        yield f"data: {json.dumps({'event': 'workflow_done', 'status': result.get('status', 'completed'), 'result': result}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── 获取结果 ────────────────────────────────────────────

@router.get("/workflow/{workflow_id}/result", response_model=APIResponse)
async def get_result(workflow_id: str):
    """获取工作流最终结果。"""
    from app.services.agent_service import get_workflow_result
    result = get_workflow_result(workflow_id)
    if not result:
        raise HTTPException(status_code=404, detail="工作流不存在")
    return APIResponse(success=True, data=result)


# ── 历史列表 ────────────────────────────────────────────

@router.get("/workflows", response_model=APIResponse)
async def list_workflows(limit: int = Query(50)):
    """获取历史工作流列表。"""
    from app.services.agent_service import get_workflow_history
    history = get_workflow_history(limit)
    return APIResponse(success=True, data={"workflows": history, "total": len(history)})


# ── 删除记录 ────────────────────────────────────────────

@router.delete("/workflow/{workflow_id}", response_model=APIResponse)
async def delete_workflow_record(workflow_id: str):
    """删除工作流记录，同时清理教学台账中心和资料与题库中的关联内容。"""
    from app.services.agent_service import delete_workflow
    info = delete_workflow(workflow_id)
    if info is None:
        raise HTTPException(status_code=404, detail="工作流不存在或删除失败")
    # 构建清理提示
    parts = ["工作流记录已删除"]
    if info.get("plan_deleted"):
        parts.append("教学台账中的教案")
    if info.get("questions_deleted"):
        parts.append(f"资料与题库中的 {info['questions_deleted']} 道题目")
    if info.get("material_deleted"):
        parts.append("关联的教学资料")
    return APIResponse(success=True, message="、".join(parts) + " 已同步清理")
