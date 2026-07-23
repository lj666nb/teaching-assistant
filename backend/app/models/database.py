"""
数据库模型 — SQLAlchemy ORM 定义。

提供课程、教案、作业、出题、学情等实体的持久化存储。
所有 AI 生成结果存入数据库，容器重启不丢失。

支持 PostgreSQL（生产 / 多项目互通）和 SQLite（本地开发）。
"""

from __future__ import annotations

import json
import logging
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text, create_engine, inspect
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


def init_db():
    """初始化数据库表，并对已有表执行轻量级迁移。"""
    Base.metadata.create_all(bind=engine)

    # ── 轻量迁移：补列（兼容 SQLite 旧库升级 & PostgreSQL 新部署） ──
    _ensure_columns("homework_grades", {
        "source_file": "TEXT DEFAULT ''",
        "batch_id": "TEXT DEFAULT ''",
        "is_archived": "BOOLEAN DEFAULT FALSE",
        "project_id": "TEXT DEFAULT 'ta-project'",
    })
    _ensure_columns("insight_reports", {
        "project_id": "TEXT DEFAULT 'ta-project'",
    })
    _ensure_columns("materials", {
        "project_id": "TEXT DEFAULT 'ta-project'",
    })
    _ensure_columns("teaching_aux", {
        "project_id": "TEXT DEFAULT 'ta-project'",
    })


# ═══════════════════════════════════════════════════════════
# 1. 智能备课
# ═══════════════════════════════════════════════════════════

class LessonPlan(Base):
    """教案（完整生成结果持久化）。"""
    __tablename__ = "lesson_plans"

    id = Column(Text, primary_key=True)
    course_name = Column(Text, nullable=False, index=True)
    chapter = Column(Text, nullable=False)
    total_hours = Column(Integer, default=2)
    additional_requirements = Column(Text, default="")
    plan_data = Column(Text, nullable=False)  # JSON 序列化的完整教案
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "course_name": self.course_name,
            "chapter": self.chapter,
            "total_hours": self.total_hours,
            "additional_requirements": self.additional_requirements,
            "plan_data": json.loads(self.plan_data) if self.plan_data else {},
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

    id = Column(Text, primary_key=True)
    student_name = Column(Text, nullable=False)
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
    project_id = Column(Text, default="ta-project", index=True)  # 数据来源项目
    created_at = Column(DateTime, default=datetime.now)

    def to_dict(self) -> dict:
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
            "strengths": json.loads(self.strengths) if self.strengths else [],
            "weaknesses": json.loads(self.weaknesses) if self.weaknesses else [],
            "suggestions": json.loads(self.suggestions) if self.suggestions else [],
            "knowledge_points": json.loads(self.knowledge_points) if self.knowledge_points else [],
            "detailed_analysis": self.detailed_analysis,
            "source_file": self.source_file,
            "batch_id": self.batch_id,
            "is_archived": self.is_archived,
            "project_id": self.project_id,
            "_source": "seed" if self.id.startswith("seed_") else "user",
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


class ExerciseBatch(Base):
    """出题批次（一次生成的一组题目）。"""
    __tablename__ = "exercise_batches"

    id = Column(Text, primary_key=True)
    course_name = Column(Text, nullable=False, index=True)
    chapter = Column(Text, default="")
    difficulty = Column(Text, default="中等")
    total = Column(Integer, default=0)
    exercises_json = Column(Text, nullable=False)  # 完整题目列表
    created_at = Column(DateTime, default=datetime.now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "course_name": self.course_name,
            "chapter": self.chapter,
            "difficulty": self.difficulty,
            "total": self.total,
            "exercises": json.loads(self.exercises_json) if self.exercises_json else [],
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


# ═══════════════════════════════════════════════════════════
# 3. 教学资料 & AI 出题
# ═══════════════════════════════════════════════════════════

class Material(Base):
    """教学资料（上传的文件元数据）。"""
    __tablename__ = "materials"

    id = Column(Text, primary_key=True)
    filename = Column(Text, nullable=False)
    course = Column(Text, default="未分类", index=True)
    chapter = Column(Text, default="")
    size_bytes = Column(Integer, default=0)
    size_display = Column(Text, default="")
    pages = Column(Integer, default=0)
    text_preview = Column(Text, default="")
    text_content = Column(Text, default="")
    file_path = Column(Text, default="")
    project_id = Column(Text, default="ta-project", index=True)  # 数据来源项目
    created_at = Column(DateTime, default=datetime.now)

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
            "_source": "seed" if self.id.startswith("seed_") else "user",
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


class Question(Base):
    """AI 生成题目。"""
    __tablename__ = "questions"

    id = Column(Text, primary_key=True)
    batch_id = Column(Text, nullable=False, index=True)
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
    created_at = Column(DateTime, default=datetime.now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "batch_id": self.batch_id,
            "course": self.course,
            "question": self.question,
            "type": self.type,
            "options": json.loads(self.options) if self.options else [],
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

    id = Column(Text, primary_key=True)
    student_id = Column(Text, nullable=False, index=True)
    course_name = Column(Text, nullable=False)
    report_type = Column(Text, default="individual")
    report_json = Column(Text, nullable=False)
    project_id = Column(Text, default="ta-project", index=True)  # 数据来源项目
    created_at = Column(DateTime, default=datetime.now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "student_id": self.student_id,
            "course_name": self.course_name,
            "report_type": self.report_type,
            "report": json.loads(self.report_json) if self.report_json else {},
            "project_id": self.project_id,
            "_source": "seed" if self.id.startswith("seed_") else "user",
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


# ═══════════════════════════════════════════════════════════
# 5. 教学辅助（重难点分析 / 课堂素材 / 课件优化）
# ═══════════════════════════════════════════════════════════

class TeachingAux(Base):
    """教学辅助素材（重难点/课堂素材/课件优化等）。"""
    __tablename__ = "teaching_aux"

    id = Column(Text, primary_key=True)
    course = Column(Text, nullable=False, index=True)
    chapter = Column(Text, nullable=False)
    aux_type = Column(Text, nullable=False)  # difficulty | classroom | ppt | variant
    content_json = Column(Text, nullable=False)
    project_id = Column(Text, default="ta-project", index=True)  # 数据来源项目
    created_at = Column(DateTime, default=datetime.now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "course": self.course,
            "chapter": self.chapter,
            "aux_type": self.aux_type,
            "content": json.loads(self.content_json) if self.content_json else {},
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
    model = Column(String(100), default="")
    function_name = Column(String(100), default="")
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    latency_ms = Column(Integer, default=0)
    success = Column(Integer, default=1)
    error_message = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.now)


# ═══════════════════════════════════════════════════════════
# 7. 教案审计日志（全生命周期留痕）
# ═══════════════════════════════════════════════════════════

class AuditLog(Base):
    """教案操作审计日志 — 不可篡改的操作记录。"""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    plan_id = Column(Text, nullable=False, index=True)
    plan_name = Column(Text, default="")  # 冗余存储，方便查询
    course_name = Column(Text, default="")
    chapter = Column(Text, default="")
    operation = Column(Text, nullable=False)  # create / view / edit / export / delete / restore
    operator = Column(Text, default="系统")  # 操作人
    operator_role = Column(Text, default="教师")  # 教师 / 管理员
    session_index = Column(Integer, nullable=True)  # 修改的具体流程索引（null=全教案操作）
    changes_before = Column(Text, default="")  # 修改前快照（JSON）
    changes_after = Column(Text, default="")  # 修改后快照（JSON）
    detail = Column(Text, default="")  # 操作描述
    ip_address = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.now, index=True)

    def to_dict(self) -> dict:
        import json as _json
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
            "changes_before": _json.loads(self.changes_before) if self.changes_before else {},
            "changes_after": _json.loads(self.changes_after) if self.changes_after else {},
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
    plan_data = Column(Text, nullable=False)  # 完整教案 JSON
    created_by = Column(Text, default="系统")
    created_at = Column(DateTime, default=datetime.now)

    def to_dict(self) -> dict:
        import json as _json
        return {
            "id": self.id,
            "plan_id": self.plan_id,
            "version": self.version,
            "plan_data": _json.loads(self.plan_data) if self.plan_data else {},
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


# ═══════════════════════════════════════════════════════════
# 8. Agent 工作流编排
# ═══════════════════════════════════════════════════════════

class AgentWorkflow(Base):
    """Agent 编排工作流记录。"""
    __tablename__ = "agent_workflows"

    id = Column(Text, primary_key=True)
    type = Column(Text, nullable=False, index=True)
    status = Column(Text, default="pending", index=True)
    input_params = Column(Text, default="{}")
    steps = Column(Text, default="[]")
    final_output = Column(Text, default="{}")
    created_at = Column(DateTime, default=datetime.now)
    completed_at = Column(DateTime, nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "input_params": json.loads(self.input_params) if self.input_params else {},
            "steps": json.loads(self.steps) if self.steps else [],
            "final_output": json.loads(self.final_output) if self.final_output else {},
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
    name = Column(Text, nullable=False)              # "助教系统" / "助学系统"
    token_hash = Column(Text, nullable=False)        # SHA256(project_token)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else "",
        }


# ═══════════════════════════════════════════════════════════
# 初始化
# ═══════════════════════════════════════════════════════════
init_db()
