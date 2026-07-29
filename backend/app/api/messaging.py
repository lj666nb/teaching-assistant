"""
师生通信 API — 学生与教师之间的实时消息系统。

提供会话管理、消息收发、SSE 实时推送。
所有数据存储在 PostgreSQL / SQLite（通过共享数据库互通）。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid as _uuid_mod
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy import desc, or_
from sqlalchemy.orm import Session

from app.models.database import (
    MessageConversation,
    MessageRecord,
    get_db,
)
from app.models.schemas import APIResponse

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/messaging", tags=["师生通信"])

# ── SSE 连接池（内存中维护活跃连接） ─────────────────────────
# key: "student:张三" 或 "teacher:admin"
# value: list[asyncio.Queue]
_sse_connections: dict[str, list[asyncio.Queue]] = {}


def _notify_user(user_key: str, event_data: dict):
    """向指定用户的 SSE 连接推送消息。"""
    queues = _sse_connections.get(user_key, [])
    dead: list[int] = []
    for i, q in enumerate(queues):
        try:
            q.put_nowait(event_data)
        except asyncio.QueueFull:
            dead.append(i)
    # 清理已满/已关闭的队列
    for i in reversed(dead):
        queues.pop(i)


# ── 文件上传目录 ─────────────────────────────────────────
UPLOAD_DIR = Path(__file__).parent.parent.parent / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ═══════════════════════════════════════════════════════════
#  文件上传
# ═══════════════════════════════════════════════════════════

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """上传文件/图片，返回访问URL。"""
    ext = Path(file.filename).suffix or ".dat"
    fname = f"{_uuid_mod.uuid4().hex}{ext}"
    fpath = UPLOAD_DIR / fname
    content = await file.read()
    fpath.write_bytes(content)
    url = f"/api/messaging/files/{fname}"
    return {"success": True, "data": {"url": url, "filename": file.filename, "size": len(content)}}


@router.get("/files/{fname}")
async def get_file(fname: str):
    """获取上传的文件。"""
    fpath = UPLOAD_DIR / fname
    if not fpath.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(fpath)


# ═══════════════════════════════════════════════════════════
#  会话管理
# ═══════════════════════════════════════════════════════════


@router.get("/conversations", response_model=APIResponse)
async def list_conversations(
    username: str = Query("", description="当前用户名"),
    role: str = Query("teacher", description="当前角色: student / teacher"),
    db: Session = Depends(get_db),
):
    """获取与当前用户相关的会话列表。"""
    query = db.query(MessageConversation)
    if role == "student":
        query = query.filter(MessageConversation.student_name == username)
    else:
        query = query.filter(MessageConversation.teacher_name == username)
    query = query.order_by(desc(MessageConversation.updated_at))

    conversations = query.all()

    # 组装会话列表，附带最后一条消息和未读数
    result = []
    for conv in conversations:
        last_msg = (
            db.query(MessageRecord)
            .filter(MessageRecord.conversation_id == conv.id)
            .order_by(desc(MessageRecord.created_at))
            .first()
        )
        # 未读数：对方发送且未读
        unread_count = (
            db.query(MessageRecord)
            .filter(
                MessageRecord.conversation_id == conv.id,
                MessageRecord.sender_role != role,
                MessageRecord.is_read == False,  # noqa: E712
            )
            .count()
        )
        result.append({
            "id": conv.id,
            "title": conv.title,
            "student_name": conv.student_name,
            "teacher_name": conv.teacher_name,
            "last_message": last_msg.content if last_msg else "",
            "last_message_role": last_msg.sender_role if last_msg else "",
            "unread_count": unread_count,
            "created_at": conv.created_at.isoformat() if conv.created_at else "",
            "updated_at": conv.updated_at.isoformat() if conv.updated_at else "",
        })

    return APIResponse(success=True, data={"conversations": result, "total": len(result)})


@router.post("/conversations", response_model=APIResponse)
async def create_conversation(
    data: dict,
    db: Session = Depends(get_db),
):
    """创建新会话。"""
    title = data.get("title", "新对话")
    student_name = data.get("student_name", "")
    teacher_name = data.get("teacher_name", "")

    if not student_name or not teacher_name:
        raise HTTPException(status_code=400, detail="学生名和教师名不能为空")

    conv = MessageConversation(
        title=title,
        student_name=student_name,
        teacher_name=teacher_name,
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)

    return APIResponse(success=True, message="会话创建成功", data=conv.to_dict())


@router.delete("/conversations/{conv_id}", response_model=APIResponse)
async def delete_conversation(
    conv_id: str,
    db: Session = Depends(get_db),
):
    """删除会话及其所有消息。"""
    conv = db.query(MessageConversation).filter(MessageConversation.id == conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 删除该会话下的所有消息
    db.query(MessageRecord).filter(MessageRecord.conversation_id == conv_id).delete()
    db.delete(conv)
    db.commit()

    return APIResponse(success=True, message="会话已删除")


# ═══════════════════════════════════════════════════════════
#  消息收发
# ═══════════════════════════════════════════════════════════


@router.get("/conversations/{conv_id}/messages", response_model=APIResponse)
async def list_messages(
    conv_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """获取会话的消息列表（分页）。"""
    conv = db.query(MessageConversation).filter(MessageConversation.id == conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="会话不存在")

    total = (
        db.query(MessageRecord)
        .filter(MessageRecord.conversation_id == conv_id)
        .count()
    )

    messages = (
        db.query(MessageRecord)
        .filter(MessageRecord.conversation_id == conv_id)
        .order_by(MessageRecord.created_at.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return APIResponse(
        success=True,
        data={
            "messages": [m.to_dict() for m in messages],
            "total": total,
            "page": page,
            "page_size": page_size,
        },
    )


@router.post("/conversations/{conv_id}/messages", response_model=APIResponse)
async def send_message(
    conv_id: str,
    data: dict,
    db: Session = Depends(get_db),
):
    """发送一条消息。"""
    sender_name = data.get("sender_name", "")
    sender_role = data.get("sender_role", "")
    content = data.get("content", "")

    if not content.strip():
        raise HTTPException(status_code=400, detail="消息内容不能为空")
    if not sender_name or not sender_role:
        raise HTTPException(status_code=400, detail="发送者信息不完整")

    conv = db.query(MessageConversation).filter(MessageConversation.id == conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="会话不存在")

    content_type = data.get("content_type", "text")
    file_url = data.get("file_url", "")
    file_name = data.get("file_name", "")

    if content_type != "text" and file_url:
        display_content = f"[{'图片' if content_type == 'image' else '文件'}]{file_name or content.strip()}"
    else:
        display_content = content.strip()

    msg = MessageRecord(
        conversation_id=conv_id,
        sender_name=sender_name,
        sender_role=sender_role,
        content=display_content if content_type != "text" else content.strip(),
    )
    db.add(msg)

    # 更新会话时间戳和标题
    conv.updated_at = datetime.now()
    preview = display_content if content_type != "text" else content.strip()
    if len(preview) <= 30:
        conv.title = preview
    db.commit()
    db.refresh(msg)

    # ── SSE 实时推送 ──
    # 通知对方用户
    if sender_role == "student":
        receiver_key = f"teacher:{conv.teacher_name}"
    else:
        receiver_key = f"student:{conv.student_name}"

    _notify_user(receiver_key, {
        "type": "new_message",
        "conversation_id": conv_id,
        "message": msg.to_dict(),
    })

    return APIResponse(success=True, data=msg.to_dict())


@router.put("/conversations/{conv_id}/read", response_model=APIResponse)
async def mark_conversation_read(
    conv_id: str,
    reader_role: str = Query("teacher", description="阅读者角色"),
    db: Session = Depends(get_db),
):
    """将对方发送的消息标记为已读。"""
    if reader_role == "student":
        sender_role = "teacher"
    else:
        sender_role = "student"

    updated = (
        db.query(MessageRecord)
        .filter(
            MessageRecord.conversation_id == conv_id,
            MessageRecord.sender_role == sender_role,
            MessageRecord.is_read == False,  # noqa: E712
        )
        .update({"is_read": True})
    )
    db.commit()

    return APIResponse(success=True, message=f"已标记 {updated} 条消息为已读")


@router.get("/unread-count", response_model=APIResponse)
async def get_unread_count(
    username: str = Query("", description="当前用户名"),
    role: str = Query("teacher", description="当前角色"),
    db: Session = Depends(get_db),
):
    """获取未读消息总数。"""
    # 先找到与该用户相关的会话
    if role == "student":
        convs = (
            db.query(MessageConversation.id)
            .filter(MessageConversation.student_name == username)
            .all()
        )
        sender_role = "teacher"
    else:
        convs = (
            db.query(MessageConversation.id)
            .filter(MessageConversation.teacher_name == username)
            .all()
        )
        sender_role = "student"

    conv_ids = [c[0] for c in convs]
    if not conv_ids:
        return APIResponse(success=True, data={"unread_count": 0})

    count = (
        db.query(MessageRecord)
        .filter(
            MessageRecord.conversation_id.in_(conv_ids),
            MessageRecord.sender_role == sender_role,
            MessageRecord.is_read == False,  # noqa: E712
        )
        .count()
    )

    return APIResponse(success=True, data={"unread_count": count})


# ═══════════════════════════════════════════════════════════
#  SSE 实时推送
# ═══════════════════════════════════════════════════════════


@router.get("/stream")
async def message_stream(
    username: str = Query("", description="当前用户名"),
    role: str = Query("teacher", description="当前角色"),
    db: Session = Depends(get_db),
):
    """SSE 端点 — 实时推送新消息给连接的用户。"""
    user_key = f"{role}:{username}"

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue(maxsize=50)

        # 注册连接
        if user_key not in _sse_connections:
            _sse_connections[user_key] = []
        _sse_connections[user_key].append(queue)

        _log.info(f"SSE 连接建立: {user_key} (当前 {len(_sse_connections.get(user_key, []))} 个连接)")

        try:
            # 发送初始连接确认
            yield f"event: connected\ndata: {json.dumps({'type': 'connected', 'user': username, 'role': role}, ensure_ascii=False)}\n\n"

            while True:
                try:
                    # 等待消息，每 15 秒发送心跳
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    event_type = event.get("type", "message")
                    yield f"event: {event_type}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            # 清理连接
            queues = _sse_connections.get(user_key, [])
            if queue in queues:
                queues.remove(queue)
            if not queues:
                _sse_connections.pop(user_key, None)
            _log.info(f"SSE 连接断开: {user_key}")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )
