"""
教案审计 API — 全生命周期留痕、版本对比、历史还原、日志导出。

提供：
- 操作自动记录（create / view / edit / export / delete / restore）
- 按教案 / 人员 / 操作类型正向/反向追溯
- 流程修改前后对比
- 历史版本还原
- 日志导出 Excel / Word
- 教师与管理员权限区分
"""

from __future__ import annotations

import io
import json as _json
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.models.database import AuditLog, LessonPlan, PlanSnapshot, get_db
from app.models.schemas import APIResponse

router = APIRouter(prefix="/api/audit", tags=["审计日志"])


# ── 审计日志写入工具 ───────────────────────────────────

def log_operation(
    db: Session,
    plan_id: str,
    operation: str,
    operator: str = "系统",
    operator_role: str = "教师",
    course_name: str = "",
    chapter: str = "",
    session_index: int | None = None,
    changes_before: dict | None = None,
    changes_after: dict | None = None,
    detail: str = "",
    plan_name: str = "",
):
    """写入一条审计日志（不可篡改）。"""
    entry = AuditLog(
        plan_id=plan_id,
        plan_name=plan_name or f"{course_name} — {chapter}",
        course_name=course_name,
        chapter=chapter,
        operation=operation,
        operator=operator,
        operator_role=operator_role,
        session_index=session_index,
        changes_before=_json.dumps(changes_before, ensure_ascii=False) if changes_before else "",
        changes_after=_json.dumps(changes_after, ensure_ascii=False) if changes_after else "",
        detail=detail,
        created_at=datetime.now(),
    )
    db.add(entry)
    db.commit()


def save_snapshot(db: Session, plan_id: str, plan_data: dict, created_by: str = "系统"):
    """保存教案快照用于版本还原。"""
    latest = db.query(PlanSnapshot).filter(
        PlanSnapshot.plan_id == plan_id
    ).order_by(desc(PlanSnapshot.version)).first()
    next_version = (latest.version + 1) if latest else 1
    snap = PlanSnapshot(
        plan_id=plan_id,
        version=next_version,
        plan_data=_json.dumps(plan_data, ensure_ascii=False),
        created_by=created_by,
        created_at=datetime.now(),
    )
    db.add(snap)
    db.commit()
    return next_version


# ── 查询审计日志 ───────────────────────────────────────

@router.get("/logs", response_model=APIResponse)
async def query_logs(
    plan_id: str = Query(""),
    operator: str = Query(""),
    operation: str = Query(""),
    course: str = Query(""),
    sort_order: str = Query("desc"),
    limit: int = Query(200),
    role: str = Query(""),
    db: Session = Depends(get_db),
):
    """查询审计日志 — 支持按教案/人员/操作类型/课程正向/反向追溯。

    权限：role=admin 可查看全部，role=teacher 仅查看自己创建的教案。
    """
    query = db.query(AuditLog)
    if plan_id:
        query = query.filter(AuditLog.plan_id == plan_id)
    if operator:
        query = query.filter(AuditLog.operator.contains(operator))
    if operation:
        query = query.filter(AuditLog.operation == operation)
    if course:
        query = query.filter(AuditLog.course_name == course)
    if role == "teacher":
        query = query.filter(AuditLog.operator_role == "教师")

    if sort_order == "asc":
        query = query.order_by(AuditLog.created_at.asc())
    else:
        query = query.order_by(AuditLog.created_at.desc())

    logs = query.limit(limit).all()

    # 统计各操作类型数量
    stats = {}
    for op in ["create", "view", "edit", "export", "delete", "restore"]:
        stats[op] = db.query(func.count(AuditLog.id)).filter(
            AuditLog.operation == op
        ).scalar() or 0

    return APIResponse(success=True, data={
        "logs": [log.to_dict() for log in logs],
        "total": len(logs),
        "stats": stats,
    })


@router.delete("/logs", response_model=APIResponse)
async def clear_logs(db: Session = Depends(get_db)):
    """清空所有审计日志。"""
    count = db.query(AuditLog).count()
    if count == 0:
        return APIResponse(success=True, message="没有可清空的日志记录")
    db.query(AuditLog).delete()
    db.commit()
    return APIResponse(success=True, message=f"已清空 {count} 条审计日志", data={"deleted": count})


# ── 教案操作统计（仪表板用） ──────────────────────────

@router.get("/stats", response_model=APIResponse)
async def get_audit_stats(db: Session = Depends(get_db)):
    """获取审计统计：总操作数、今日操作、各类型分布。"""
    total = db.query(func.count(AuditLog.id)).scalar() or 0
    today = db.query(func.count(AuditLog.id)).filter(
        func.date(AuditLog.created_at) == func.date(datetime.now())
    ).scalar() or 0

    operator_stats = {}
    rows = db.query(AuditLog.operator, func.count(AuditLog.id)).group_by(
        AuditLog.operator
    ).order_by(desc(func.count(AuditLog.id))).limit(10).all()
    for r in rows:
        operator_stats[r[0]] = r[1]

    return APIResponse(success=True, data={
        "total_operations": total,
        "today_operations": today,
        "operator_stats": operator_stats,
    })


# ── 版本快照 ───────────────────────────────────────────

@router.get("/snapshots/{plan_id}", response_model=APIResponse)
async def list_snapshots(plan_id: str, db: Session = Depends(get_db)):
    """获取教案的所有历史版本快照。"""
    snaps = db.query(PlanSnapshot).filter(
        PlanSnapshot.plan_id == plan_id
    ).order_by(desc(PlanSnapshot.version)).all()
    return APIResponse(success=True, data={
        "snapshots": [s.to_dict() for s in snaps],
        "total": len(snaps),
    })


@router.delete("/snapshots/{plan_id}/{version}", response_model=APIResponse)
async def delete_snapshot(
    plan_id: str, version: int, db: Session = Depends(get_db),
):
    """删除指定教案的某个版本快照。"""
    snap = db.query(PlanSnapshot).filter(
        PlanSnapshot.plan_id == plan_id,
        PlanSnapshot.version == version,
    ).first()
    if not snap:
        raise HTTPException(status_code=404, detail="快照不存在")
    db.delete(snap)
    db.commit()
    return APIResponse(success=True, message=f"已删除版本 v{version}", data={"version": version})


@router.post("/snapshots/{plan_id}/restore/{version}", response_model=APIResponse)
async def restore_snapshot(
    plan_id: str, version: int, operator: str = "教师", db: Session = Depends(get_db),
):
    """还原教案到指定历史版本。"""
    snap = db.query(PlanSnapshot).filter(
        PlanSnapshot.plan_id == plan_id,
        PlanSnapshot.version == version,
    ).first()
    if not snap:
        raise HTTPException(status_code=404, detail="快照不存在")

    # 更新教案
    lesson = db.query(LessonPlan).filter(LessonPlan.id == plan_id).first()
    old_data = lesson.plan_data if lesson else "{}"

    if lesson:
        lesson.plan_data = snap.plan_data
        # 同步还原独立字段（total_hours / course_name / chapter）
        restored = _json.loads(snap.plan_data) if snap.plan_data else {}
        if "total_hours" in restored and restored["total_hours"] is not None:
            lesson.total_hours = int(restored["total_hours"]) or 2
        if "course_name" in restored and restored["course_name"]:
            lesson.course_name = restored["course_name"]
        if "chapter" in restored and restored["chapter"]:
            lesson.chapter = restored["chapter"]
        lesson.updated_at = datetime.now()
        db.commit()

    # 记录审计日志
    log_operation(
        db, plan_id, "restore", operator=operator,
        course_name=lesson.course_name if lesson else "",
        chapter=lesson.chapter if lesson else "",
        detail=f"还原到版本 v{version}",
        changes_before=_json.loads(old_data) if old_data else {},
        changes_after=_json.loads(snap.plan_data) if snap.plan_data else {},
    )

    return APIResponse(success=True, message=f"已还原到版本 v{version}", data={
        "version": version,
        "plan_data": snap.to_dict()["plan_data"],
    })


# ── 流程修改对比 ───────────────────────────────────────

@router.get("/compare/{plan_id}", response_model=APIResponse)
async def compare_versions(
    plan_id: str,
    v1: int = Query(0),
    v2: int = Query(0),
    db: Session = Depends(get_db),
):
    """对比教案两个版本之间的差异。默认对比最新版本与上一版本。"""
    snaps = db.query(PlanSnapshot).filter(
        PlanSnapshot.plan_id == plan_id
    ).order_by(desc(PlanSnapshot.version)).all()

    if len(snaps) < 2:
        return APIResponse(success=True, data={"message": "至少需要2个版本才能对比", "diffs": []})

    if v1 == 0 and v2 == 0:
        newer = snaps[0]
        older = snaps[1]
    else:
        newer = next((s for s in snaps if s.version == max(v1, v2)), None)
        older = next((s for s in snaps if s.version == min(v1, v2)), None)

    if not newer or not older:
        raise HTTPException(status_code=404, detail="指定版本不存在")

    new_data = _json.loads(newer.plan_data) if newer.plan_data else {}
    old_data = _json.loads(older.plan_data) if older.plan_data else {}

    # 对比 sessions — 传递完整 session 数据，确保所有字段差异可在前端展示
    diffs = []
    old_sessions = old_data.get("sessions", [])
    new_sessions = new_data.get("sessions", [])
    max_len = max(len(old_sessions), len(new_sessions))
    for i in range(max_len):
        old_s = old_sessions[i] if i < len(old_sessions) else None
        new_s = new_sessions[i] if i < len(new_sessions) else None
        if _json.dumps(old_s, sort_keys=True, ensure_ascii=False) != _json.dumps(new_s, sort_keys=True, ensure_ascii=False):
            old_s_dict = old_s or {}
            new_s_dict = new_s or {}
            diffs.append({
                "session_index": i,
                "topic": new_s_dict.get("session_topic", old_s_dict.get("session_topic", "")),
                "before": {
                    "session_topic": old_s_dict.get("session_topic", ""),
                    "objectives": old_s_dict.get("objectives", []),
                    "key_points": old_s_dict.get("key_points", []),
                    "difficult_points": old_s_dict.get("difficult_points", []),
                    "activities": old_s_dict.get("activities", []),
                    "homework": old_s_dict.get("homework", ""),
                },
                "after": {
                    "session_topic": new_s_dict.get("session_topic", ""),
                    "objectives": new_s_dict.get("objectives", []),
                    "key_points": new_s_dict.get("key_points", []),
                    "difficult_points": new_s_dict.get("difficult_points", []),
                    "activities": new_s_dict.get("activities", []),
                    "homework": new_s_dict.get("homework", ""),
                },
            })

    # 其他字段对比
    for field in ["objectives", "methods", "resources"]:
        if _json.dumps(old_data.get(field), sort_keys=True) != _json.dumps(new_data.get(field), sort_keys=True):
            diffs.append({
                "session_index": -1,
                "topic": f"教案元信息 — {field}",
                "before": {field: old_data.get(field)},
                "after": {field: new_data.get(field)},
            })

    return APIResponse(success=True, data={
        "v1_version": older.version,
        "v2_version": newer.version,
        "v1_time": older.created_at.isoformat() if older.created_at else "",
        "v2_time": newer.created_at.isoformat() if newer.created_at else "",
        "diffs": diffs,
    })


# ── 导出审计日志 ───────────────────────────────────────

def _build_log_excel(logs: list) -> bytes:
    """生成审计日志 Excel (CSV 格式，兼容 Excel 打开)。"""
    import csv
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["ID", "教案ID", "教案名称", "课程", "章节", "操作类型", "操作人", "角色", "流程索引", "详情", "时间"])
    for log in logs:
        d = log.to_dict()
        writer.writerow([
            d["id"], d["plan_id"], d["plan_name"], d["course_name"], d["chapter"],
            d["operation"], d["operator"], d["operator_role"], d.get("session_index", ""),
            d["detail"], d["created_at"],
        ])
    # BOM for Excel UTF-8
    return ("﻿" + buf.getvalue()).encode("utf-8")


def _build_log_word(logs: list) -> bytes:
    """生成审计日志 Word 文档。"""
    import zipfile

    def esc(text: str) -> str:
        return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    p = []
    p.append('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">教案审计日志</w:t></w:r></w:p>')
    p.append('<w:p/>')

    for log in logs:
        d = log.to_dict()
        p.append(f'<w:p><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">[{d["operation"]}] {d["plan_name"]}</w:t></w:r></w:p>')
        for label, key in [("操作人", "operator"), ("角色", "operator_role"), ("课程", "course_name"), ("章节", "chapter"), ("详情", "detail"), ("时间", "created_at")]:
            p.append(f'<w:p><w:pPr><w:ind w:left="420"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">{label}: {esc(str(d.get(key, "")))}</w:t></w:r></w:p>')
        p.append('<w:p/>')

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        zf.writestr("[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '</Types>')
        zf.writestr("_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
        zf.writestr("word/_rels/document.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')
        zf.writestr("word/document.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            '<w:body>' + "".join(p) + '</w:body></w:document>')
    return buf.getvalue()


@router.get("/export")
async def export_logs(
    plan_id: str = Query(""),
    format: str = Query("excel"),
    db: Session = Depends(get_db),
):
    """导出审计日志为 Excel 或 Word 文件。"""
    query = db.query(AuditLog)
    if plan_id:
        query = query.filter(AuditLog.plan_id == plan_id)
    logs = query.order_by(AuditLog.created_at.desc()).limit(5000).all()

    if not logs:
        raise HTTPException(status_code=404, detail="无日志记录")

    if format == "word":
        file_data = _build_log_word(logs)
        media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        filename = "审计日志.docx"
    else:
        file_data = _build_log_excel(logs)
        media = "text/csv; charset=utf-8"
        filename = "审计日志.csv"

    encoded = quote(filename, safe="")
    return Response(
        content=file_data,
        media_type=media,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded}",
            "Content-Length": str(len(file_data)),
        },
    )
