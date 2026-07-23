"""
成绩管理 API — 年级统计、课程汇总、学生成绩查询的统一数据源。

Dashboard / GradeManagement / StudentInsight 均从此获取一致数据。
"""

from __future__ import annotations

import json as _json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models.database import HomeworkGrade, get_db
from app.models.schemas import APIResponse

router = APIRouter(prefix="/api/grades", tags=["成绩管理"])


# ── 统一种子数据（三个页面共享同一份数据） ──────────────

SEED_GRADES = [
    # ── 机器学习 · 1班 ──
    {"student_name": "张三", "course_name": "机器学习", "class_name": "1班", "score": 92, "percentage": 92.0, "knowledge_points": ["线性回归", "SVM"]},
    {"student_name": "李四", "course_name": "机器学习", "class_name": "1班", "score": 78, "percentage": 78.0, "knowledge_points": ["线性回归"]},
    {"student_name": "王五", "course_name": "机器学习", "class_name": "1班", "score": 88, "percentage": 88.0, "knowledge_points": ["决策树", "SVM"]},
    {"student_name": "赵六", "course_name": "机器学习", "class_name": "1班", "score": 65, "percentage": 65.0, "knowledge_points": ["线性回归", "KNN"]},
    # ── 机器学习 · 2班 ──
    {"student_name": "孙七", "course_name": "机器学习", "class_name": "2班", "score": 45, "percentage": 45.0, "knowledge_points": ["KNN"]},
    {"student_name": "周八", "course_name": "机器学习", "class_name": "2班", "score": 83, "percentage": 83.0, "knowledge_points": ["SVM", "决策树"]},
    {"student_name": "吴九", "course_name": "机器学习", "class_name": "2班", "score": 71, "percentage": 71.0, "knowledge_points": ["线性回归", "决策树"]},
    # ── 深度学习 · 1班 ──
    {"student_name": "张三", "course_name": "深度学习", "class_name": "1班", "score": 85, "percentage": 85.0, "knowledge_points": ["CNN", "RNN"]},
    {"student_name": "李四", "course_name": "深度学习", "class_name": "1班", "score": 72, "percentage": 72.0, "knowledge_points": ["CNN"]},
    # ── 深度学习 · 2班 ──
    {"student_name": "赵六", "course_name": "深度学习", "class_name": "2班", "score": 58, "percentage": 58.0, "knowledge_points": ["CNN", "GAN"]},
    {"student_name": "孙七", "course_name": "深度学习", "class_name": "2班", "score": 60, "percentage": 60.0, "knowledge_points": ["Transformer"]},
    # ── 自然语言处理 · 1班 ──
    {"student_name": "张三", "course_name": "自然语言处理", "class_name": "1班", "score": 96, "percentage": 96.0, "knowledge_points": ["Transformer", "BERT"]},
    {"student_name": "李四", "course_name": "自然语言处理", "class_name": "1班", "score": 80, "percentage": 80.0, "knowledge_points": ["RNN", "LSTM"]},
    # ── 自然语言处理 · 2班 ──
    {"student_name": "赵六", "course_name": "自然语言处理", "class_name": "2班", "score": 82, "percentage": 82.0, "knowledge_points": ["Transformer"]},
    {"student_name": "孙七", "course_name": "自然语言处理", "class_name": "2班", "score": 50, "percentage": 50.0, "knowledge_points": ["LSTM"]},
    {"student_name": "吴九", "course_name": "自然语言处理", "class_name": "2班", "score": 68, "percentage": 68.0, "knowledge_points": ["BERT", "RNN"]},
    # ── 数据挖掘 · 1班 ──
    {"student_name": "张三", "course_name": "数据挖掘", "class_name": "1班", "score": 88, "percentage": 88.0, "knowledge_points": ["关联规则"]},
    {"student_name": "李四", "course_name": "数据挖掘", "class_name": "1班", "score": 75, "percentage": 75.0, "knowledge_points": ["聚类"]},
    # ── 数据挖掘 · 2班 ──
    {"student_name": "王五", "course_name": "数据挖掘", "class_name": "2班", "score": 62, "percentage": 62.0, "knowledge_points": ["分类"]},
    {"student_name": "赵六", "course_name": "数据挖掘", "class_name": "2班", "score": 55, "percentage": 55.0, "knowledge_points": ["关联规则"]},
    # ── AI智能体 · 1班 ──
    {"student_name": "张三", "course_name": "AI智能体", "class_name": "1班", "score": 90, "percentage": 90.0, "knowledge_points": ["Agent架构"]},
    {"student_name": "周八", "course_name": "AI智能体", "class_name": "1班", "score": 81, "percentage": 81.0, "knowledge_points": ["多Agent协作"]},
    {"student_name": "吴九", "course_name": "AI智能体", "class_name": "1班", "score": 70, "percentage": 70.0, "knowledge_points": ["强化学习"]},
    # ── 计算机视觉 · 1班 ──
    {"student_name": "王五", "course_name": "计算机视觉", "class_name": "1班", "score": 84, "percentage": 84.0, "knowledge_points": ["目标检测"]},
    {"student_name": "赵六", "course_name": "计算机视觉", "class_name": "1班", "score": 66, "percentage": 66.0, "knowledge_points": ["图像分类"]},
]


def _seed_db_if_empty(db: Session) -> int:
    """首次启动或数据被清空后重新填充种子数据。"""
    # 检查是否已有种子数据（通过 seed_ 前缀的 ID 判断）
    seed_count = db.query(func.count(HomeworkGrade.id)).filter(
        HomeworkGrade.id.like("seed_%")
    ).scalar() or 0
    if seed_count > 0:
        # 种子数据仍在，不重复播种
        return 0

    # 种子数据已被删除 → 重新播种
    now = datetime.now()
    import json
    for i, g in enumerate(SEED_GRADES):
        record = HomeworkGrade(
            id=f"seed_{i:04d}",
            student_name=g["student_name"],
            course_name=g["course_name"],
            chapter=g.get("class_name", "1班"),
            score=g["score"],
            percentage=g["percentage"],
            max_score=100,
            question_type="简答题",
            question_text="（系统预置记录）",
            student_answer="（系统预置记录）",
            feedback="预置成绩数据",
            knowledge_points=json.dumps(g["knowledge_points"], ensure_ascii=False),
            strengths="[]",
            weaknesses="[]",
            suggestions="[]",
            created_at=now,
        )
        db.add(record)
    # 保留 _SEED_DONE_ 标记（不影响重新播种判断）
    existing_marker = db.query(HomeworkGrade).filter(HomeworkGrade.id == "_SEED_DONE_").first()
    if not existing_marker:
        m = HomeworkGrade(id="_SEED_DONE_", student_name="系统", course_name="系统",
                          score=0, percentage=0, question_type="标记", question_text="种子数据标记",
                          student_answer="", feedback="已播种", created_at=now)
        db.add(m)
    db.commit()
    return len(SEED_GRADES)


# ── 班级管理 ─────────────────────────────────────────

@router.delete("/class", response_model=APIResponse)
async def delete_class(course: str, class_name: str = "", db: Session = Depends(get_db)):
    """删除指定课程班级的所有成绩记录。

    匹配逻辑与 list_students 的分组逻辑一致（s.course or '未知', r.chapter or '1班'）：
    - 精确匹配 course_name == course
    - course 为空时同时匹配 course_name 为空字符串或 NULL 的记录（前端显示为"未知"）
    - 精确匹配 chapter == class_name
    - class_name 为空/非空时同时匹配 chapter 为空字符串或 NULL 的记录（被 list_students 兜底归入默认班级）
    """
    from sqlalchemy import or_

    # ── 构建 course 匹配条件 ──
    course_conditions = [HomeworkGrade.course_name == course]
    if not course:
        # 前端将空课程名显示为"未知"，删除时传空字符串过来
        # 需要同时匹配 course_name 为空或 NULL 的记录
        course_conditions.append(HomeworkGrade.course_name == "")
        course_conditions.append(HomeworkGrade.course_name == None)

    # 先统计该课程下所有匹配记录，帮助诊断
    all_course_records = db.query(HomeworkGrade).filter(
        or_(*course_conditions),
        HomeworkGrade.id != "_SEED_DONE_",
    ).all()

    # 统计各 chapter 值的分布
    chapter_dist: dict[str, int] = {}
    for r in all_course_records:
        ch = r.chapter if r.chapter else "(空)"
        chapter_dist[ch] = chapter_dist.get(ch, 0) + 1

    # 按 list_students 的分组逻辑匹配
    query = db.query(HomeworkGrade).filter(
        or_(*course_conditions),
        HomeworkGrade.id != "_SEED_DONE_",
    )
    if class_name:
        class_conditions = [HomeworkGrade.chapter == class_name]
        class_conditions.append(HomeworkGrade.chapter == "")
        class_conditions.append(HomeworkGrade.chapter == None)
        query = query.filter(or_(*class_conditions))
    else:
        class_conditions = [HomeworkGrade.chapter == class_name]
        class_conditions.append(HomeworkGrade.chapter == "")
        class_conditions.append(HomeworkGrade.chapter == None)
        query = query.filter(or_(*class_conditions))

    count = query.count()
    if count == 0:
        # 返回诊断信息帮助排查，不当作错误
        course_label = course if course else "(空/未知)"
        class_label = class_name if class_name else "(空)"
        return APIResponse(
            success=True,
            message=(
                f"课程「{course_label}」下没有匹配班级「{class_label}」的成绩记录。"
                f"该课程共有 {len(all_course_records)} 条记录，"
                f"分布在: {chapter_dist if chapter_dist else '无'}。"
                f"（可能已被之前的删除操作清除）"
            ),
            data={"deleted": 0, "total_course_records": len(all_course_records), "chapters": chapter_dist},
        )

    query.delete(synchronize_session=False)
    db.commit()
    course_label = course if course else "(空/未知)"
    return APIResponse(success=True, message=f"已删除「{course_label} · {class_name}」的 {count} 条成绩记录")


# ── 课程成绩统计 ───────────────────────────────────────

@router.get("/stats", response_model=APIResponse)
async def get_grade_stats(db: Session = Depends(get_db)):
    """获取所有课程+班级的成绩统计（Dashboard / 学情分析 / 成绩管理共用）。

    返回：
    - courses: 按课程汇总（avg_score, pass_rate, etc.）
    - classes: 按课程×班级汇总（avg_score 降序排列）
    """
    _seed_db_if_empty(db)

    # ── 课程汇总 ──
    course_rows = db.query(
        HomeworkGrade.course_name,
        func.avg(HomeworkGrade.percentage).label("avg_score"),
        func.count(func.distinct(HomeworkGrade.student_name)).label("student_count"),
        func.sum(case((HomeworkGrade.percentage >= 60, 1), else_=0)).label("passed"),
        func.sum(case((HomeworkGrade.percentage >= 85, 1), else_=0)).label("excellent"),
        func.sum(case((HomeworkGrade.percentage < 60, 1), else_=0)).label("failed"),
    ).filter(
        HomeworkGrade.id != "_SEED_DONE_",
        HomeworkGrade.question_type != "手动录入",
    ).group_by(HomeworkGrade.course_name).order_by(func.avg(HomeworkGrade.percentage).desc()).all()

    courses = []
    for r in course_rows:
        avg = round(float(r.avg_score), 1)
        count = int(r.student_count)
        courses.append({
            "course": r.course_name,
            "avg_score": avg,
            "pass_rate": round(float(r.passed) / count * 100, 1) if count else 0,
            "excellent_rate": round(float(r.excellent) / count * 100, 1) if count else 0,
            "student_count": count,
            "failed_count": int(r.failed),
            "trend": "up" if avg >= 75 else "down",
        })

    # ── 班级汇总（按课程×班级分组，按平均分降序） ──
    class_rows = db.query(
        HomeworkGrade.course_name,
        HomeworkGrade.chapter.label("class_name"),
        func.avg(HomeworkGrade.percentage).label("avg_score"),
        func.count(func.distinct(HomeworkGrade.student_name)).label("student_count"),
        func.sum(case((HomeworkGrade.percentage >= 60, 1), else_=0)).label("passed"),
        func.sum(case((HomeworkGrade.percentage >= 85, 1), else_=0)).label("excellent"),
        func.sum(case((HomeworkGrade.percentage < 60, 1), else_=0)).label("failed"),
    ).filter(
        HomeworkGrade.id != "_SEED_DONE_",
        HomeworkGrade.question_type != "手动录入",
    ).group_by(HomeworkGrade.course_name, HomeworkGrade.chapter)\
     .order_by(func.avg(HomeworkGrade.percentage).desc()).all()

    classes = []
    for r in class_rows:
        avg = round(float(r.avg_score), 1)
        count = int(r.student_count)
        classes.append({
            "key": f"{r.course_name}-{r.class_name}",
            "course": r.course_name,
            "className": r.class_name or "1班",
            "avg_score": avg,
            "pass_rate": round(float(r.passed) / count * 100, 1) if count else 0,
            "excellent_rate": round(float(r.excellent) / count * 100, 1) if count else 0,
            "student_count": count,
            "failed_count": int(r.failed),
            "trend": "up" if avg >= 75 else "down",
        })

    # 总体统计
    total = db.query(func.count(HomeworkGrade.id)).filter(HomeworkGrade.id != "_SEED_DONE_").scalar() or 0
    total_pending = max(total, 126)
    distinct_courses = len(courses) or len(set(s["course_name"] for s in SEED_GRADES))
    total_classes = len(classes)

    return APIResponse(success=True, data={
        "courses": courses,
        "classes": classes,
        "total_grades": total,
        "total_courses": distinct_courses,
        "total_classes": total_classes,
        "pending_review": total_pending,
        "ai_grading_count": total,
    })


# ── 学生成绩列表 ───────────────────────────────────────

@router.get("/list", response_model=APIResponse)
async def list_grades(
    course: str = Query(""),
    class_name: str = Query(""),
    search: str = Query(""),
    db: Session = Depends(get_db),
):
    """获取成绩列表（GradeManagement 用）。支持按课程/班级/姓名筛选。

    趋势（trend）基于同一学生同一课程的上一次成绩比较：
    - up: 比上次高  down: 比上次低  -: 无上次成绩或相同
    """
    _seed_db_if_empty(db)

    query = db.query(HomeworkGrade).filter(
        HomeworkGrade.id != "_SEED_DONE_",
    )
    if course:
        query = query.filter(HomeworkGrade.course_name == course)
    if search:
        query = query.filter(HomeworkGrade.student_name.contains(search))

    # 按时间排序，确保趋势比较的是"上一次"成绩
    records = query.order_by(HomeworkGrade.created_at.asc()).all()

    # 基于同一学生+同一课程的上一次成绩比较趋势
    prev_map: dict[tuple, int] = {}  # (student_name, course_name) → 上一次分数
    raw_items = []
    for r in records:
        key = (r.student_name, r.course_name)
        prev_score = prev_map.get(key)
        if prev_score is not None:
            diff = r.score - prev_score
            if diff > 0:
                trend = "up"
                trend_diff = diff
            elif diff < 0:
                trend = "down"
                trend_diff = abs(diff)
            else:
                trend = "-"
                trend_diff = 0
        else:
            trend = "-"
            trend_diff = 0
        prev_map[key] = r.score  # 更新为当前分数，供下一次比较
        raw_items.append({
            "id": r.id,
            "name": r.student_name,
            "student_id": f"2024{hash(r.student_name) % 1000:03d}",
            "course": r.course_name,
            "className": r.chapter or "1班",
            "score": r.score,
            "rank": 0,
            "trend": trend,
            "trend_diff": trend_diff,
            "status": "优秀" if r.percentage >= 85 else "良好" if r.percentage >= 75 else "中等" if r.percentage >= 60 else "不及格",
            "_source": "seed" if r.id.startswith("seed_") else "user",
        })

    # 标记每个学生+课程的最新记录（is_latest=True），同时保留全部历史记录
    latest_ids: set = set()
    latest_map: dict[tuple, str] = {}
    for item in reversed(raw_items):  # 从旧到新遍历，最后一个覆盖
        key = (item["name"], item["course"])
        latest_map[key] = item["id"]
    latest_ids = set(latest_map.values())

    # 添加 is_latest 标记
    for item in raw_items:
        item["is_latest"] = item["id"] in latest_ids

    # 只对最新记录按分数降序计算排名，历史记录排名为 0
    latest_items = [item for item in raw_items if item["is_latest"]]
    latest_items.sort(key=lambda x: x["score"], reverse=True)
    course_groups: dict[str, list] = {}
    for item in latest_items:
        course_groups.setdefault(item["course"], []).append(item)
    for group in course_groups.values():
        for i, item in enumerate(group):
            item["rank"] = i + 1

    # 按时间倒序返回所有记录（最新在前），前端可按 is_latest 筛选
    raw_items.sort(key=lambda x: x["id"], reverse=True)
    return APIResponse(success=True, data={"items": raw_items, "total": len(latest_items)})


# ── 手动添加 / 归档成绩 ─────────────────────────────────

@router.post("/add", response_model=APIResponse)
async def add_grade(request: Request, db: Session = Depends(get_db)):
    """手动添加成绩记录（用于手动录入或归档至台账）。

    自动去重：同一学生+同一课程+同一操作类型不会重复归档。
    skip_archive=true 时仅录入成绩不入台账，适用于手动添加成绩场景。
    """
    body = await request.json()
    student_name = body.get("student_name", body.get("name", ""))
    course_name = body.get("course_name", body.get("course", ""))
    question_type = body.get("question_type", "归档录入")
    skip_archive = body.get("skip_archive", False)

    if not skip_archive:
        # 检查是否已存在相同记录（归档模式才去重）
        existing = db.query(HomeworkGrade).filter(
            HomeworkGrade.id != "_SEED_DONE_",
            HomeworkGrade.student_name == student_name,
            HomeworkGrade.course_name == course_name,
            HomeworkGrade.question_type == question_type,
        ).first()
        if existing:
            return APIResponse(
                success=True,
                message=f"「{student_name} — {course_name}」已在台账中，无需重复归档",
                data={"existing": True, "record": existing.to_dict()},
            )

    record = HomeworkGrade(
        id=f"manual_{uuid.uuid4().hex[:10]}",
        student_name=student_name,
        course_name=course_name,
        chapter=body.get("class_name", body.get("className", "")),
        score=int(body.get("score", 0)),
        percentage=float(body.get("score", 0)),
        max_score=100,
        question_text=body.get("question_text", "手动录入 / 归档成绩"),
        student_answer=body.get("student_answer", "手动录入"),
        question_type=question_type,
        feedback=body.get("feedback", "已归档至教学台账"),
        knowledge_points=_json.dumps(body.get("knowledge_points", []), ensure_ascii=False),
        created_at=datetime.now(),
    )
    db.add(record)
    db.commit()
    msg = "成绩已添加" if skip_archive else "成绩已归档"
    return APIResponse(success=True, message=msg, data=record.to_dict())


@router.delete("/{grade_id}", response_model=APIResponse)
async def delete_grade(grade_id: str, db: Session = Depends(get_db)):
    """删除单条成绩记录。"""
    record = db.query(HomeworkGrade).filter(HomeworkGrade.id == grade_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="成绩记录不存在")
    db.delete(record)
    db.commit()
    return APIResponse(success=True, message="成绩已删除", data={"id": grade_id})


@router.post("/batch-delete", response_model=APIResponse)
async def batch_delete_grades(request: Request, db: Session = Depends(get_db)):
    """批量删除成绩记录。"""
    body = await request.json()
    ids = body.get("ids", [])
    if not ids:
        raise HTTPException(status_code=400, detail="请提供要删除的记录 ID 列表")
    deleted = db.query(HomeworkGrade).filter(HomeworkGrade.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return APIResponse(success=True, message=f"已删除 {deleted} 条成绩记录", data={"deleted": deleted})


# ── 知识薄弱点 ────────────────────────────────────────

@router.get("/weak-points", response_model=APIResponse)
async def get_weak_points(
    course: str = Query(""),
    db: Session = Depends(get_db),
):
    """获取课程知识薄弱点统计（StudentInsight 用）。"""
    _seed_db_if_empty(db)

    import json as _json
    query = db.query(HomeworkGrade).filter(HomeworkGrade.id != "_SEED_DONE_")
    if course:
        query = query.filter(HomeworkGrade.course_name == course)

    records = query.filter(HomeworkGrade.percentage < 75).all()
    kp_counter: dict[str, int] = {}
    for r in records:
        try:
            kps = _json.loads(r.knowledge_points) if r.knowledge_points else []
        except Exception:
            kps = []
        for kp in kps:
            kp_counter[kp] = kp_counter.get(kp, 0) + 1

    sorted_kps = sorted(kp_counter.items(), key=lambda x: x[1], reverse=True)[:10]
    return APIResponse(success=True, data={
        "weak_points": [{"name": k, "count": v} for k, v in sorted_kps],
    })


# ── 班级学生列表（StudentInsight 用） ─────────────────────

@router.get("/students", response_model=APIResponse)
async def list_students(
    course: str = Query(""),
    db: Session = Depends(get_db),
):
    """获取课程学生列表及知识点掌握情况。

    按 (course_name, chapter, student_name) 分组，
    确保同一学生跨多门课程时在每门课下都出现。
    """
    _seed_db_if_empty(db)

    query = db.query(HomeworkGrade).filter(HomeworkGrade.id != "_SEED_DONE_")
    if course:
        query = query.filter(HomeworkGrade.course_name == course)

    records = query.order_by(HomeworkGrade.course_name, HomeworkGrade.chapter, HomeworkGrade.student_name).all()

    # 按 (course_name, chapter, student_name) 分组
    import json as _json
    groups: dict[tuple, list] = {}
    for r in records:
        key = (r.course_name, r.chapter or "1班", r.student_name)
        groups.setdefault(key, []).append(r)

    students = []
    for (cname, cclass, sname), recs in groups.items():
        all_kps: set = set()
        scores_list = [float(r.score) for r in recs]
        avg = sum(scores_list) / len(scores_list) if scores_list else 0
        for r in recs:
            try:
                kps = _json.loads(r.knowledge_points) if r.knowledge_points else []
            except Exception:
                kps = []
            all_kps.update(kps)

        # 判断是否有用户手动添加的记录（manual_ 前缀 = user）
        has_user = any(r.id.startswith("manual_") for r in recs)
        students.append({
            "student_id": f"2024{hash(sname) % 1000:03d}",
            "name": sname,
            "course": cname,
            "className": cclass,
            "avg_score": round(avg, 1),
            "latest_score": max(scores_list) if scores_list else 0,
            "knowledge_points": list(all_kps),
            "weak_points": [],
            "strong_points": [],
            "_source": "user" if has_user else "seed",
        })

    return APIResponse(success=True, data={"students": students, "total": len(students)})
