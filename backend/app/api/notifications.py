"""
消息通知 API — 全系统统一通知存储。
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.models.schemas import APIResponse

router = APIRouter(prefix="/api/notifications", tags=["消息通知"])

# 文件存储路径
NOTIFICATIONS_FILE = Path(__file__).parent.parent.parent / "data" / "notifications.json"


def _read() -> list[dict]:
    if not NOTIFICATIONS_FILE.exists():
        return []
    try:
        return json.loads(NOTIFICATIONS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _write(data: list[dict]) -> None:
    NOTIFICATIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    NOTIFICATIONS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _seed_notifications():
    """首次使用自动填充示例通知数据。"""
    now = datetime.now().isoformat()[:19]
    return [
        {"id": "seed_1", "type": "作业", "title": "机器学习 · KNN算法作业提交提醒", "desc": "已有 42/62 名学生提交，截止今日 18:00", "time": "2 小时前", "time_raw": now, "unread": True, "route": "/homework"},
        {"id": "seed_2", "type": "批改", "title": "深度学习 · CNN实验报告批改完成", "desc": "AI 已批改 28 份，请登录查看批改报告", "time": "3 小时前", "time_raw": now, "unread": True, "route": "/homework"},
        {"id": "seed_3", "type": "预警", "title": "学情预警：NLP 课程成绩下滑", "desc": "3 名学生连续两次成绩下降超过 15%", "time": "昨天", "time_raw": now, "unread": True, "route": "/insight"},
        {"id": "seed_4", "type": "系统", "title": "LLM 服务配置提醒", "desc": "请检查 API Key 是否有效，以免影响批改功能", "time": "昨天", "time_raw": now, "unread": False},
        {"id": "seed_5", "type": "作业", "title": "计算机视觉 · 期末试卷已导入", "desc": "56 份试卷已就绪，可开始 AI 批改", "time": "2 天前", "time_raw": now, "unread": False, "route": "/homework"},
        {"id": "seed_6", "type": "系统", "title": "系统版本更新 v2.0", "desc": "新增智教星品牌、API Key 守卫、教学台账", "time": "3 天前", "time_raw": now, "unread": False},
        {"id": "seed_7", "type": "预警", "title": "数据结构 · 2班 成绩临界预警", "desc": "赵六、孙七最新成绩处于及格边缘（55-65分）", "time": "3 天前", "time_raw": now, "unread": False, "route": "/insight"},
        {"id": "seed_8", "type": "作业", "title": "自然语言处理 · 作业截止提醒", "desc": "Transformer模型作业将于明日 18:00 截止提交", "time": "5 天前", "time_raw": now, "unread": False, "route": "/homework"},
    ]


def create_notification(ntype: str, title: str, desc: str, route: str = "") -> dict:
    """由其他模块调用，创建一条通知。"""
    notifications = _read()
    item = {
        "id": str(uuid.uuid4())[:8],
        "type": ntype,
        "title": title,
        "desc": desc,
        "time": "刚刚",
        "time_raw": datetime.now().isoformat()[:19],
        "unread": True,
        "route": route,
    }
    notifications.append(item)
    _write(notifications)
    return item


@router.get("/list", response_model=APIResponse)
async def list_notifications():
    """获取通知列表（种子数据仅首次初始化）。"""
    items = _read()

    # ── 一次性种子初始化 ──
    # 检查是否已有种子数据（通过 seed_ 前缀的 ID 判断）
    has_seeds = any(i["id"].startswith("seed_") for i in items)
    if not has_seeds:
        seed_items = _seed_notifications()
        items = seed_items + items
        _write(items)

    items.sort(key=lambda x: (not x["id"].startswith("seed_"), x.get("time_raw", "")), reverse=True)
    return APIResponse(success=True, data={"total": len(items), "items": items})


@router.post("/read-all", response_model=APIResponse)
async def mark_all_read():
    """全部标记已读。"""
    items = _read()
    for item in items:
        item["unread"] = False
    _write(items)
    return APIResponse(success=True, message="已全部标记为已读")


@router.put("/{nid}/read", response_model=APIResponse)
async def mark_read(nid: str):
    """标记单条已读。"""
    items = _read()
    for item in items:
        if item["id"] == nid:
            item["unread"] = False
            _write(items)
            return APIResponse(success=True)
    raise HTTPException(status_code=404, detail="通知不存在")


@router.delete("/{nid}", response_model=APIResponse)
async def delete_notification(nid: str):
    """删除单条通知。"""
    items = _read()
    before = len(items)
    items = [i for i in items if i["id"] != nid]
    if len(items) == before:
        raise HTTPException(status_code=404, detail="通知不存在")
    _write(items)
    return APIResponse(success=True, message="已删除")


@router.post("/batch-delete", response_model=APIResponse)
async def batch_delete(data: dict):
    """批量删除通知。"""
    ids = set(data.get("ids", []))
    if not ids:
        raise HTTPException(status_code=400, detail="请选择要删除的通知")
    items = _read()
    items = [i for i in items if i["id"] not in ids]
    _write(items)
    return APIResponse(success=True, message=f"已删除 {len(ids)} 条通知")
