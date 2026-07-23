"""
运行时设置 API — 支持多 LLM 供应商配置管理与一键切换。

可保存多个供应商配置（名称/API Key/地址/模型），
随时切换激活项，配置持久化存储。
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.core.llm import (
    activate_provider,
    get_active_provider,
    get_all_providers,
    save_provider,
    delete_provider,
    test_llm_connection,
)
from app.models.schemas import APIResponse

router = APIRouter(prefix="/api/settings", tags=["系统设置"])


# ── 供应商管理 ──────────────────────────────────────────

@router.get("/providers", response_model=APIResponse)
async def list_providers():
    """获取所有已保存的供应商配置（不返回 API Key）。"""
    providers = get_all_providers()
    # 脱敏 API Key
    safe = []
    for p in providers:
        safe.append({
            "id": p["id"],
            "name": p["name"],
            "base_url": p["base_url"],
            "model_name": p["model_name"],
            "is_active": p["is_active"],
            "api_key_preview": p["api_key"][:8] + "..." if len(p["api_key"]) > 10 else "已配置",
            "has_key": bool(p["api_key"]),
        })
    return APIResponse(success=True, data={"providers": safe, "total": len(safe)})


@router.post("/providers", response_model=APIResponse)
async def add_provider(data: dict):
    """
    新增供应商配置。

    请求体：
    {
        "name": "我的 DeepSeek",
        "api_key": "sk-xxx",
        "base_url": "https://api.deepseek.com",
        "model_name": "deepseek-chat"
    }
    """
    required = ["name", "api_key", "base_url", "model_name"]
    for field in required:
        if field not in data or not data[field]:
            raise HTTPException(status_code=400, detail=f"缺少必填字段：{field}")

    provider = {
        "id": str(uuid.uuid4())[:8],
        "name": data["name"].strip(),
        "api_key": data["api_key"].strip(),
        "base_url": data["base_url"].strip(),
        "model_name": data["model_name"].strip(),
        "is_active": False,
    }
    save_provider(provider)
    return APIResponse(success=True, message=f"已添加供应商「{provider['name']}」", data={"id": provider["id"]})


@router.put("/providers/{provider_id}", response_model=APIResponse)
async def update_provider(provider_id: str, data: dict):
    """
    更新供应商配置。只更新提供的字段。
    """
    providers = get_all_providers()
    target = None
    for p in providers:
        if p["id"] == provider_id:
            target = p
            break
    if not target:
        raise HTTPException(status_code=404, detail="供应商不存在")

    for key in ("name", "api_key", "base_url", "model_name"):
        if key in data and data[key]:
            target[key] = data[key].strip()

    save_provider(target)  # 覆盖保存
    return APIResponse(success=True, message="已更新")


@router.delete("/providers/{provider_id}", response_model=APIResponse)
async def remove_provider(provider_id: str):
    """删除供应商配置。"""
    ok = delete_provider(provider_id)
    if not ok:
        raise HTTPException(status_code=404, detail="供应商不存在")
    return APIResponse(success=True, message="已删除")


@router.post("/providers/{provider_id}/activate", response_model=APIResponse)
async def activate_provider_api(provider_id: str):
    """切换激活指定的供应商。"""
    ok = activate_provider(provider_id)
    if not ok:
        raise HTTPException(status_code=404, detail="供应商不存在")
    active = get_active_provider()
    return APIResponse(success=True, message=f"已切换至「{active['name']}」", data={
        "name": active["name"],
        "base_url": active["base_url"],
        "model_name": active["model_name"],
    })


@router.get("/active", response_model=APIResponse)
async def get_active():
    """获取当前激活的供应商信息（不含 API Key）。"""
    active = get_active_provider()
    if not active:
        return APIResponse(success=True, data={"configured": False})
    return APIResponse(success=True, data={
        "configured": True,
        "name": active["name"],
        "base_url": active["base_url"],
        "model_name": active["model_name"],
        "has_key": bool(active["api_key"]),
    })


# ── 连接测试 ────────────────────────────────────────────

@router.post("/test", response_model=APIResponse)
async def test_connection(data: dict | None = None):
    """
    测试 LLM 连接。

    优先级：请求体 > 请求头 (X-LLM-Api-Key) > 激活的供应商 > 环境变量
    """
    # 1. 请求体中的配置（优先）
    if data and data.get("api_key"):
        api_key = data["api_key"]
        base_url = data.get("base_url", "")
        model_name = data.get("model_name", "")
    # 2. 请求头中的配置（前端浏览器端配置）
    elif data is not None:
        # 请求体为空对象 {} 时，回退到请求头/激活供应商/环境变量
        api_key = ""
        base_url = ""
        model_name = ""
    # 3. 无请求体时使用激活的供应商（多模型结构：从默认模型取值）
    else:
        active = get_active_provider()
        if not active:
            return APIResponse(success=False, message="未配置 API Key，请先添加供应商")
        base_url = active.get("base_url", "")
        models = active.get("models", [])
        if models:
            default_model = next((m for m in models if m.get("is_default")), models[0])
            api_key = default_model.get("api_key", "")
            model_name = default_model.get("model_name", "")
        else:
            # 兼容旧版
            api_key = active.get("api_key", "")
            model_name = active.get("model_name", "")
        if not api_key:
            return APIResponse(success=False, message="未配置 API Key，请先添加供应商")

    success, msg = test_llm_connection(
        api_key=api_key,
        base_url=base_url,
        model_name=model_name,
    )
    return APIResponse(success=success, message=msg)
