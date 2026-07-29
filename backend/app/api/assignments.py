"""
作业管理 API — 布置作业、提交、批改打分
"""

from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.models.database import (
    HomeworkAssignment,
    HomeworkSubmission,
    get_db,
)

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assignments", tags=["作业管理"])


# ═══════════════════════════════════════════════════════════
#  作业 CRUD
# ═══════════════════════════════════════════════════════════

@router.get("")
async def list_assignments(
    teacher: str = Query("", description="按教师过滤"),
    student: str = Query("", description="按学生过滤"),
    course: str = Query("", description="按课程过滤"),
    status: str = Query("", description="按状态过滤"),
    db: Session = Depends(get_db),
):
    """获取作业列表。"""
    q = db.query(HomeworkAssignment)
    if teacher:
        q = q.filter(HomeworkAssignment.teacher_name == teacher)
    if course:
        q = q.filter(HomeworkAssignment.course_name == course)
    if status:
        q = q.filter(HomeworkAssignment.status == status)
    if student:
        # 学生：返回该学生被选中的作业
        q = q.filter(HomeworkAssignment.status == "published")
        all_assignments = q.order_by(desc(HomeworkAssignment.created_at)).all()
        result = [
            a.to_dict() for a in all_assignments
            if student in (a.selected_students or []) or not a.selected_students
        ]
        return {"success": True, "data": {"assignments": result, "total": len(result)}}

    assignments = q.order_by(desc(HomeworkAssignment.created_at)).all()
    return {"success": True, "data": {"assignments": [a.to_dict() for a in assignments], "total": len(assignments)}}


@router.post("")
async def create_assignment(data: dict, db: Session = Depends(get_db)):
    """发布新作业。"""
    title = data.get("title", "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="作业标题不能为空")

    assignment = HomeworkAssignment(
        course_id=data.get("course_id", ""),
        course_name=data.get("course_name", ""),
        teacher_name=data.get("teacher_name", ""),
        title=title,
        content=data.get("content", ""),
        deadline=datetime.fromisoformat(data["deadline"]) if data.get("deadline") else None,
        selected_students=json.dumps(data.get("selected_students", []), ensure_ascii=False),
        attachments=json.dumps(data.get("attachments", []), ensure_ascii=False),
        question_ids=json.dumps(data.get("question_ids", []), ensure_ascii=False),
        status="published",
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return {"success": True, "message": "作业发布成功", "data": assignment.to_dict()}


@router.get("/{aid}")
async def get_assignment(aid: str, db: Session = Depends(get_db)):
    """获取单个作业详情。"""
    a = db.query(HomeworkAssignment).filter(HomeworkAssignment.id == aid).first()
    if not a:
        raise HTTPException(status_code=404, detail="作业不存在")
    return {"success": True, "data": a.to_dict()}


@router.put("/{aid}")
async def update_assignment(aid: str, data: dict, db: Session = Depends(get_db)):
    """编辑作业。"""
    a = db.query(HomeworkAssignment).filter(HomeworkAssignment.id == aid).first()
    if not a:
        raise HTTPException(status_code=404, detail="作业不存在")
    for field in ("title", "content", "status"):
        if field in data and data[field]:
            setattr(a, field, data[field])
    if data.get("deadline"):
        a.deadline = datetime.fromisoformat(data["deadline"])
    a.updated_at = datetime.now()
    db.commit()
    return {"success": True, "data": a.to_dict()}


@router.delete("/{aid}")
async def delete_assignment(aid: str, db: Session = Depends(get_db)):
    """删除作业及其所有提交。"""
    a = db.query(HomeworkAssignment).filter(HomeworkAssignment.id == aid).first()
    if not a:
        raise HTTPException(status_code=404, detail="作业不存在")
    db.query(HomeworkSubmission).filter(HomeworkSubmission.assignment_id == aid).delete()
    db.delete(a)
    db.commit()
    return {"success": True, "message": "已删除"}


# ═══════════════════════════════════════════════════════════
#  提交管理
# ═══════════════════════════════════════════════════════════

@router.get("/{aid}/submissions")
async def list_submissions(aid: str, db: Session = Depends(get_db)):
    """获取某作业的全部学生提交。"""
    subs = (
        db.query(HomeworkSubmission)
        .filter(HomeworkSubmission.assignment_id == aid)
        .order_by(desc(HomeworkSubmission.submitted_at))
        .all()
    )
    return {"success": True, "data": {"submissions": [s.to_dict() for s in subs], "total": len(subs)}}


@router.post("/{aid}/submit")
async def submit_homework(aid: str, data: dict, db: Session = Depends(get_db)):
    """学生提交作业。"""
    student_name = data.get("student_name", "").strip()
    if not student_name:
        raise HTTPException(status_code=400, detail="学生名不能为空")

    # 检查是否已提交
    existing = (
        db.query(HomeworkSubmission)
        .filter(
            HomeworkSubmission.assignment_id == aid,
            HomeworkSubmission.student_name == student_name,
        )
        .first()
    )
    if existing:
        existing.content = data.get("content", existing.content)
        existing.files = json.dumps(data.get("files", []), ensure_ascii=False)
        existing.status = "submitted"
        existing.submitted_at = datetime.now()
        db.commit()
        db.refresh(existing)

        # 更新作业统计
        _update_assignment_stats(aid, db)
        return {"success": True, "message": "提交成功（已更新）", "data": existing.to_dict()}

    sub = HomeworkSubmission(
        assignment_id=aid,
        student_name=student_name,
        content=data.get("content", ""),
        files=json.dumps(data.get("files", []), ensure_ascii=False),
        status="submitted",
        submitted_at=datetime.now(),
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    _update_assignment_stats(aid, db)
    return {"success": True, "message": "提交成功", "data": sub.to_dict()}


@router.put("/submissions/{sid}/grade")
async def grade_submission(sid: str, data: dict, db: Session = Depends(get_db)):
    """批改打分。"""
    sub = db.query(HomeworkSubmission).filter(HomeworkSubmission.id == sid).first()
    if not sub:
        raise HTTPException(status_code=404, detail="提交不存在")

    sub.score = data.get("score", sub.score)
    sub.feedback = data.get("feedback", sub.feedback)
    sub.graded_by = data.get("graded_by", sub.graded_by)
    sub.status = "graded"
    sub.graded_at = datetime.now()
    db.commit()

    _update_assignment_stats(sub.assignment_id, db)
    return {"success": True, "data": sub.to_dict()}


@router.get("/submissions/student/{student_name}")
async def student_submissions(student_name: str, db: Session = Depends(get_db)):
    """查看某学生的所有提交（含作业信息）。"""
    subs = (
        db.query(HomeworkSubmission)
        .filter(HomeworkSubmission.student_name == student_name)
        .order_by(desc(HomeworkSubmission.submitted_at))
        .all()
    )
    result = []
    for s in subs:
        item = s.to_dict()
        a = db.query(HomeworkAssignment).filter(HomeworkAssignment.id == s.assignment_id).first()
        item["assignment"] = a.to_dict() if a else None
        result.append(item)
    return {"success": True, "data": {"submissions": result, "total": len(result)}}


# ═══════════════════════════════════════════════════════════
#  统计
# ═══════════════════════════════════════════════════════════

@router.get("/stats/pending-grading")
async def pending_grading_count(db: Session = Depends(get_db)):
    """待批改提交数。"""
    count = (
        db.query(HomeworkSubmission)
        .filter(HomeworkSubmission.status == "submitted")
        .count()
    )
    return {"success": True, "data": {"count": count}}


# ═══════════════════════════════════════════════════════════
#  辅助
# ═══════════════════════════════════════════════════════════

def _update_assignment_stats(aid: str, db: Session):
    """更新作业统计数字。"""
    a = db.query(HomeworkAssignment).filter(HomeworkAssignment.id == aid).first()
    if not a:
        return
    a.submission_count = (
        db.query(HomeworkSubmission)
        .filter(HomeworkSubmission.assignment_id == aid)
        .count()
    )
    a.graded_count = (
        db.query(HomeworkSubmission)
        .filter(
            HomeworkSubmission.assignment_id == aid,
            HomeworkSubmission.status == "graded",
        )
        .count()
    )
    a.updated_at = datetime.now()
    db.commit()
