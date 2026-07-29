"""
数据库模型 — SQLAlchemy ORM 定义。

提供课程、教案、作业、出题、学情等实体的持久化存储。
所有 AI 生成结果存入数据库，容器重启不丢失。

支持 PostgreSQL（生产 / 多项目互通）和 SQLite（本地开发）。
云端 PostgreSQL 与项目11共用 tiaozhanbei 数据库。
"""

from __future__ import annotations

import json
import logging
import uuid as _uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Float, Integer, String, Text,
    create_engine, inspect, text as sa_text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

_log = logging.getLogger(__name__)

# ── 数据库引擎 ──────────────────────────────────────────────
# 根据 database_url 自动适配 PostgreSQL 或 SQLite
_is_sqlite = "sqlite" in settings.database_url

_connect_args: dict = {}
if _is_sqlite:
    _connect_args = {"check_same_thread": False, "timeout": 30}

engine = create_engine(
    settings.database_url,
    connect_args=_connect_args,
    pool_size=5 if not _is_sqlite else 0,
    max_overflow=10 if not _is_sqlite else 0,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """获取数据库会话（用于 FastAPI 依赖注入）。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ensure_columns(db_table, columns: dict[str, str]):
    """通用补列逻辑 — 兼容 PostgreSQL 和 SQLite。"""
    inspector = inspect(engine)
    try:
        existing_cols = {c["name"] for c in inspector.get_columns(db_table)}
    except Exception:
        return  # 表还不存在，create_all 会处理

    for col_name, col_type_sql in columns.items():
        if col_name not in existing_cols:
            try:
                with engine.connect() as conn:
                    conn.exec_driver_sql(
                        f"ALTER TABLE {db_table} ADD COLUMN {col_name} {col_type_sql}"
                    )
                    conn.commit()
                _log.info(f"迁移: 添加列 {db_table}.{col_name}")
            except Exception as e:
                _log.warning(f"迁移跳过 {db_table}.{col_name}: {e}")


def _gen_uuid() -> str:
    """生成 UUID 字符串，兼容所有数据库。"""
    return str(_uuid.uuid4())


def _now() -> datetime:
    return datetime.now()


def init_db():
    """初始化数据库表，并对已有表执行轻量级迁移。"""
    # ── 迁移: 删除旧 TEXT-id 表，重新用 UUID-id 创建 ──
    # 仅在教学表全部为空时执行（安全保护）
    _migrate_to_uuid_if_needed()

    Base.metadata.create_all(bind=engine)

    # ── 轻量迁移：补列 ──
    _ensure_columns("homework_grades", {
        "source_file": "TEXT DEFAULT ''",
        "batch_id": "TEXT DEFAULT ''",
        "is_archived": "BOOLEAN DEFAULT FALSE",
        "project_id": "TEXT DEFAULT 'ta-project'",
    })
    _ensure_columns("insight_reports", {
        "project_id": "TEXT DEFAULT 'ta-project'",
        "student_id": "TEXT DEFAULT ''",
    })
    _ensure_columns("materials", {
        "project_id": "TEXT DEFAULT 'ta-project'",
    })
    _ensure_columns("teaching_aux", {
        "project_id": "TEXT DEFAULT 'ta-project'",
    })


def _migrate_to_uuid_if_needed():
    """如果数据库中 teaching-assistant 表的 id 列类型与 SQLAlchemy 模型不匹配
    （如 PostgreSQL UUID 类型），且表为空，则删除后重建。"""
    if _is_sqlite:
        return  # SQLite 无需迁移

    # SQLAlchemy String(36) → PostgreSQL character varying(36)
    ta_tables = [
        "lesson_plans", "homework_grades", "exercise_batches", "materials",
        "questions", "insight_reports", "teaching_aux", "agent_workflows",
        "llm_call_logs", "audit_logs", "plan_snapshots",
    ]

    with engine.connect() as conn:
        for table_name in ta_tables:
            try:
                # 检查表是否存在
                result = conn.exec_driver_sql(
                    f"SELECT EXISTS (SELECT FROM information_schema.tables "
                    f"WHERE table_name = '{table_name}')"
                )
                exists = result.fetchone()[0]
                if not exists:
                    continue

                # 检查是否为空表
                count = conn.exec_driver_sql(
                    f"SELECT COUNT(*) FROM {table_name}"
                ).fetchone()[0]
                if count > 0:
                    _log.info(f"迁移: {table_name} 有 {count} 条数据，跳过重建")
                    continue

                # 检查 id 列类型 — 如果不是 character varying(36) 则重建
                col_info = conn.exec_driver_sql(
                    f"SELECT data_type, character_maximum_length "
                    f"FROM information_schema.columns "
                    f"WHERE table_name = '{table_name}' AND column_name = 'id'"
                ).fetchone()
                if col_info is None:
                    continue
                col_type, col_len = col_info[0], col_info[1]
                # 需要重建: UUID 类型, TEXT 类型, 或 varchar 但不是 36 位
                needs_rebuild = (
                    col_type in ("uuid", "text") or
                    (col_type == "character varying" and col_len != 36)
                )
                if needs_rebuild:
                    conn.exec_driver_sql(f"DROP TABLE IF EXISTS {table_name} CASCADE")
                    conn.commit()
                    _log.info(
                        f"迁移: 删除 {table_name}({col_type}), "
                        f"将以 character varying(36) 重建"
                    )
            except Exception as e:
                _log.warning(f"迁移检查 {table_name}: {e}")
                conn.rollback()


# ═══════════════════════════════════════════════════════════
# 1. 智能备课
# ═══════════════════════════════════════════════════════════

class LessonPlan(Base):
    """教案（完整生成结果持久化）。"""
    __tablename__ = "lesson_plans"

    id = Column(String(36), primary_key=True, default=_gen_uuid)
    user_id = Column(Integer, nullable=True, default=1)
    course_name = Column(Text, nullable=False, index=True)
    chapter = Column(Text, nullable=True, default="")
    total_hours = Column(Integer, default=2)
    additional_requirements = Column(Text, default="")
    plan_data = Column(Text, nullable=False)  # JSON 序列化的完整教案
    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "course_name": self.course_name,
            "chapter": self.chapter,
            "total_hours": self.total_hours,
            "additional_requirements": self.additional_requirements,
            "plan_data": json.loads(self.plan_data) if isinstance(self.plan_data, str) else self.plan_data,
            "_source": "ai",
            "created_at": self.created_at.isoformat() if self.created_at else "",
            "updated_at": self.updated_at.isoformat() if self.updated_at else "",
        }


# ═══════════════════════════════════════════════════════════
# 2. 作业批改
# ═══════════════════════════════════════════════════════════

class HomeworkGrade(Base):
    """作业批改结果。"""
    __tablename__ = "homework_grades"

    id = Column(String(36), primary_key=True, default=_gen_uuid)
    user_id = Column(Integer, nullable=True, default=1)
    student_name = Column(Text, nullable=True, default="")
    course_name = Column(Text, nullable=False, index=True)
    chapter = Column(Text, default="")
    question_text = Column(Text, default="")
    student_answer = Column(Text, default="")
    question_type = Column(Text, default="主观题")
    max_score = Column(Float, default=100)
    score = Column(Float, default=0)
    percentage = Column(Float, default=0)
    feedback = Column(Text, default="")
    strengths = Column(Text, default="[]")
    weaknesses = Column(Text, default="[]")
    suggestions = Column(Text, default="[]")
    knowledge_points = Column(Text, default="[]")
    detailed_analysis = Column(Text, default="")
    source_file = Column(Text, default="")
    batch_id = Column(Text, default="")
    is_archived = Column(Boolean, default=False)
    project_id = Column(Text, default="ta-project", index=True)
    created_at = Column(DateTime, default=_now)

    def to_dict(self) -> dict:
        def _json_parse(val):
            if isinstance(val, str):
                try:
                    return json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return []
            return val or []

        return {
            "id": self.id,
            "student_name": self.student_name,
            "course_name": self.course_name,
            "chapter": self.chapter,
            "question_text": self.question_text,
            "student_answer": self.student_answer,
            "question_type": self.question_type,
            "max_score": self.max_score,
            "score": self.score,
            "percentage": self.percentage,
            "feedback": self.feedback,
            "strengths": _json_parse(self.strengths),
            "weaknesses": _json_parse(self.weaknesses),
            "suggestions": _json_parse(self.suggestions),
            "knowledge_points": _json_parse(self.knowledge_points),
            "detailed_analysis": self.detailed_analysis,
            "source_file": self.source_file,
            "batch_id": self.batch_id,
            "is_archived": self.is_archived,
            "project_id": self.project_id,
            "_source": "seed" if (self.id or "").startswith("seed_") else "user",
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


class ExerciseBatch(Base):
    """出题批次（一次生成的一组题目）。"""
    __tablename__ = "exercise_batches"

    id = Column(String(36), primary_key=True, default=_gen_uuid)
    user_id = Column(Integer, nullable=True, default=1)
    course_name = Column(Text, nullable=False, index=True)
    chapter = Column(Text, default="")
    difficulty = Column(Text, default="中等")
    total = Column(Integer, default=0)
    exercises_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "course_name": self.course_name,
            "chapter": self.chapter,
            "difficulty": self.difficulty,
            "total": self.total,
            "exercises": json.loads(self.exercises_json) if isinstance(self.exercises_json, str) else self.exercises_json,
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


# ═══════════════════════════════════════════════════════════
# 3. 教学资料 & AI 出题
# ═══════════════════════════════════════════════════════════

class Material(Base):
    """教学资料（上传的文件元数据）。"""
    __tablename__ = "materials"

    id = Column(String(36), primary_key=True, default=_gen_uuid)
    user_id = Column(Integer, nullable=True, default=1)
    filename = Column(Text, nullable=False)
    course = Column(Text, default="未分类", index=True)
    chapter = Column(Text, default="")
    size_bytes = Column(Integer, default=0)
    size_display = Column(Text, default="")
    pages = Column(Integer, default=0)
    text_preview = Column(Text, default="")
    text_content = Column(Text, default="")
    file_path = Column(Text, default="")
    project_id = Column(Text, default="ta-project", index=True)
    created_at = Column(DateTime, default=_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "filename": self.filename,
            "course": self.course,
            "chapter": self.chapter,
            "size": self.size_bytes,
            "size_display": self.size_display,
            "pages": self.pages,
            "text_preview": self.text_preview,
            "project_id": self.project_id,
            "_source": "seed" if (self.id or "").startswith("seed_") else "user",
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


class Question(Base):
    """AI 生成题目。"""
    __tablename__ = "questions"

    id = Column(String(36), primary_key=True, default=_gen_uuid)
    user_id = Column(Integer, nullable=True, default=1)
    batch_id = Column(Text, nullable=True, index=True)
    course = Column(Text, default="")
    question = Column(Text, nullable=False)
    type = Column(Text, default="简答题")
    options = Column(Text, default="[]")
    answer = Column(Text, default="")
    difficulty = Column(Text, default="中等")
    knowledge_point = Column(Text, default="")
    explanation = Column(Text, default="")
    estimated_time = Column(Integer, default=5)
    status = Column(Text, default="draft")
    scoring_rubric = Column(Text, default="")
    common_mistakes = Column(Text, default="")
    cognitive_level = Column(Text, default="")
    source = Column(Text, default="")
    created_at = Column(DateTime, default=_now)

    def to_dict(self) -> dict:
        def _json_parse(val):
            if isinstance(val, str):
                try:
                    return json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return []
            return val or []

        return {
            "id": self.id,
            "batch_id": self.batch_id,
            "course": self.course,
            "question": self.question,
            "type": self.type,
            "options": _json_parse(self.options),
            "answer": self.answer,
            "difficulty": self.difficulty,
            "knowledge_point": self.knowledge_point,
            "explanation": self.explanation,
            "estimated_time": self.estimated_time,
            "status": self.status,
            "scoring_rubric": self.scoring_rubric,
            "common_mistakes": self.common_mistakes,
            "cognitive_level": self.cognitive_level,
            "source": self.source,
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


# ═══════════════════════════════════════════════════════════
# 4. 学情分析
# ═══════════════════════════════════════════════════════════

class InsightReport(Base):
    """学情分析报告。"""
    __tablename__ = "insight_reports"

    id = Column(String(36), primary_key=True, default=_gen_uuid)
    user_id = Column(Integer, nullable=True, default=1)
    student_id = Column(Text, nullable=True, default="", index=True)
    course_name = Column(Text, nullable=True, default="")
    report_type = Column(Text, default="individual")
    report_json = Column(Text, nullable=False)
    project_id = Column(Text, default="ta-project", index=True)
    created_at = Column(DateTime, default=_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "student_id": self.student_id,
            "course_name": self.course_name,
            "report_type": self.report_type,
            "report": json.loads(self.report_json) if isinstance(self.report_json, str) else self.report_json,
            "project_id": self.project_id,
            "_source": "seed" if (self.id or "").startswith("seed_") else "user",
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


# ═══════════════════════════════════════════════════════════
# 5. 教学辅助（重难点分析 / 课堂素材 / 课件优化）
# ═══════════════════════════════════════════════════════════

class TeachingAux(Base):
    """教学辅助素材（重难点/课堂素材/课件优化等）。"""
    __tablename__ = "teaching_aux"

    id = Column(String(36), primary_key=True, default=_gen_uuid)
    user_id = Column(Integer, nullable=True, default=1)
    course = Column(Text, nullable=True, default="", index=True)
    chapter = Column(Text, nullable=True, default="")
    aux_type = Column(Text, nullable=True, default="")
    content_json = Column(Text, nullable=True, default="{}")
    project_id = Column(Text, default="ta-project", index=True)
    created_at = Column(DateTime, default=_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "course": self.course,
            "chapter": self.chapter,
            "aux_type": self.aux_type,
            "content": json.loads(self.content_json) if isinstance(self.content_json, str) else self.content_json,
            "project_id": self.project_id,
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


# ═══════════════════════════════════════════════════════════
# 6. LLM 调用日志（用量统计 / 审计）
# ═══════════════════════════════════════════════════════════

class LLMCallLog(Base):
    """每次 LLM 调用的记录。"""
    __tablename__ = "llm_call_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=True, default=1)
    model = Column(String(100), default="")
    function_name = Column(String(100), default="")
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    latency_ms = Column(Integer, default=0)
    success = Column(Integer, default=1)
    error_message = Column(Text, default="")
    created_at = Column(DateTime, default=_now)


# ═══════════════════════════════════════════════════════════
# 7. 教案审计日志（全生命周期留痕）
# ═══════════════════════════════════════════════════════════

class AuditLog(Base):
    """教案操作审计日志 — 不可篡改的操作记录。"""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    plan_id = Column(Text, nullable=False, index=True)
    plan_name = Column(Text, default="")
    course_name = Column(Text, default="")
    chapter = Column(Text, default="")
    operation = Column(Text, nullable=False)  # create / view / edit / export / delete / restore
    operator = Column(Text, default="系统")
    operator_role = Column(Text, default="教师")
    session_index = Column(Integer, nullable=True)
    changes_before = Column(Text, default="")
    changes_after = Column(Text, default="")
    detail = Column(Text, default="")
    ip_address = Column(Text, default="")
    created_at = Column(DateTime, default=_now, index=True)

    def to_dict(self) -> dict:
        def _parse(val):
            if isinstance(val, str):
                try:
                    return json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return {}
            return val or {}

        return {
            "id": self.id,
            "plan_id": self.plan_id,
            "plan_name": self.plan_name,
            "course_name": self.course_name,
            "chapter": self.chapter,
            "operation": self.operation,
            "operator": self.operator,
            "operator_role": self.operator_role,
            "session_index": self.session_index,
            "changes_before": _parse(self.changes_before),
            "changes_after": _parse(self.changes_after),
            "detail": self.detail,
            "ip_address": self.ip_address,
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


class PlanSnapshot(Base):
    """教案版本快照 — 用于历史版本还原。"""
    __tablename__ = "plan_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    plan_id = Column(Text, nullable=False, index=True)
    version = Column(Integer, default=1)
    plan_data = Column(Text, nullable=False)
    created_by = Column(Text, default="系统")
    created_at = Column(DateTime, default=_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "plan_id": self.plan_id,
            "version": self.version,
            "plan_data": json.loads(self.plan_data) if isinstance(self.plan_data, str) else self.plan_data,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


# ═══════════════════════════════════════════════════════════
# 8. Agent 工作流编排
# ═══════════════════════════════════════════════════════════

class AgentWorkflow(Base):
    """Agent 编排工作流记录。"""
    __tablename__ = "agent_workflows"

    id = Column(String(36), primary_key=True, default=_gen_uuid)
    user_id = Column(Integer, nullable=True, default=1)
    type = Column(Text, nullable=False, index=True)
    status = Column(Text, default="pending", index=True)
    input_params = Column(Text, default="{}")
    steps = Column(Text, default="[]")
    final_output = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_now)
    completed_at = Column(DateTime, nullable=True)

    def to_dict(self) -> dict:
        def _parse(val):
            if isinstance(val, str):
                try:
                    return json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return {}
            return val or {}

        return {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "input_params": _parse(self.input_params),
            "steps": _parse(self.steps),
            "final_output": _parse(self.final_output),
            "created_at": self.created_at.isoformat() if self.created_at else "",
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


# ═══════════════════════════════════════════════════════════
# 9. 项目互通注册
# ═══════════════════════════════════════════════════════════

class ProjectRegistry(Base):
    """多项目互通注册表 — 管理接入共享数据库的所有项目。"""
    __tablename__ = "project_registry"

    id = Column(Text, primary_key=True)             # "ta-project" / "student-project"
    name = Column(Text, nullable=False)
    token_hash = Column(Text, nullable=False)        # SHA256(project_token)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


# ═══════════════════════════════════════════════════════════
# 10. 师生通信 — 消息系统
# ═══════════════════════════════════════════════════════════

class MessageConversation(Base):
    """师生会话 — 学生与教师之间的一次对话。"""
    __tablename__ = "message_conversations"

    id = Column(String(36), primary_key=True, default=_gen_uuid)
    title = Column(Text, default="新对话")
    student_name = Column(Text, nullable=False, index=True)
    teacher_name = Column(Text, nullable=False, index=True)
    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "student_name": self.student_name,
            "teacher_name": self.teacher_name,
            "created_at": self.created_at.isoformat() if self.created_at else "",
            "updated_at": self.updated_at.isoformat() if self.updated_at else "",
        }


class MessageRecord(Base):
    """会话中的单条消息。"""
    __tablename__ = "message_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(String(36), nullable=False, index=True)
    sender_name = Column(Text, nullable=False)
    sender_role = Column(Text, nullable=False)  # 'student' | 'teacher'
    content = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "conversation_id": self.conversation_id,
            "sender_name": self.sender_name,
            "sender_role": self.sender_role,
            "content": self.content,
            "is_read": self.is_read,
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


# ═══════════════════════════════════════════════════════════
# 11. 作业发布与提交
# ═══════════════════════════════════════════════════════════

class HomeworkAssignment(Base):
    """教师发布的作业任务。"""
    __tablename__ = "homework_assignments"

    id = Column(String(36), primary_key=True, default=_gen_uuid)
    course_id = Column(Text, default="", index=True)
    course_name = Column(Text, nullable=False)
    teacher_name = Column(Text, nullable=False, index=True)
    title = Column(Text, nullable=False)
    content = Column(Text, default="")
    deadline = Column(DateTime, nullable=True)
    selected_students = Column(Text, default="[]")  # JSON 学生列表
    attachments = Column(Text, default="[]")         # JSON 附件URL列表
    question_ids = Column(Text, default="[]")        # JSON 题库题目ID
    status = Column(Text, default="published")       # draft/published/closed
    submission_count = Column(Integer, default=0)
    graded_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    def to_dict(self) -> dict:
        def _parse(val):
            if isinstance(val, str):
                try:
                    return json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return []
            return val or []
        return {
            "id": self.id,
            "course_id": self.course_id,
            "course_name": self.course_name,
            "teacher_name": self.teacher_name,
            "title": self.title,
            "content": self.content,
            "deadline": self.deadline.isoformat() if self.deadline else "",
            "selected_students": _parse(self.selected_students),
            "attachments": _parse(self.attachments),
            "question_ids": _parse(self.question_ids),
            "status": self.status,
            "submission_count": self.submission_count,
            "graded_count": self.graded_count,
            "created_at": self.created_at.isoformat() if self.created_at else "",
            "updated_at": self.updated_at.isoformat() if self.updated_at else "",
        }


class HomeworkSubmission(Base):
    """学生提交的作业。"""
    __tablename__ = "homework_submissions"

    id = Column(String(36), primary_key=True, default=_gen_uuid)
    assignment_id = Column(String(36), nullable=False, index=True)
    student_name = Column(Text, nullable=False)
    content = Column(Text, default="")
    files = Column(Text, default="[]")       # JSON 附件URL
    score = Column(Float, default=0)
    feedback = Column(Text, default="")
    graded_by = Column(Text, default="")
    status = Column(Text, default="pending")  # pending/submitted/graded
    submitted_at = Column(DateTime, nullable=True)
    graded_at = Column(DateTime, nullable=True)

    def to_dict(self) -> dict:
        def _parse(val):
            if isinstance(val, str):
                try:
                    return json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return []
            return val or []
        return {
            "id": self.id,
            "assignment_id": self.assignment_id,
            "student_name": self.student_name,
            "content": self.content,
            "files": _parse(self.files),
            "score": self.score,
            "feedback": self.feedback,
            "graded_by": self.graded_by,
            "status": self.status,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else "",
            "graded_at": self.graded_at.isoformat() if self.graded_at else "",
        }


# ═══════════════════════════════════════════════════════════
# 初始化
# ═══════════════════════════════════════════════════════════
init_db()
