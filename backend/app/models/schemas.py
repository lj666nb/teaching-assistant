"""Pydantic 数据模型 — 请求 / 响应 Schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ═══════════════════════════════════════════════════════════
#  1. 智能备课 (Lesson Planning)
# ═══════════════════════════════════════════════════════════

class LessonPlanRequest(BaseModel):
    """备课请求。"""
    course_name: str = Field(..., description="课程名称")
    chapter: str = Field(..., description="章节名称")
    textbook_content: str = Field("", description="教材内容（可选，用于RAG增强）")
    teaching_hours: int = Field(2, description="课时数")
    additional_requirements: str = Field("", description="附加要求，如'偏重实践'等")


class TeachingObjective(BaseModel):
    """教学目标。"""
    dimension: str = Field(..., description="维度：知识/能力/素质")
    content: str = Field(..., description="目标内容")


class TeachingActivity(BaseModel):
    """教学活动。"""
    duration: int = Field(..., description="时长（分钟）")
    activity_type: str = Field(..., description="类型：讲授/讨论/练习/互动/案例/小组")
    content: str = Field(..., description="内容描述")
    teacher_activity: str = Field("", description="教师活动")
    student_activity: str = Field("", description="学生活动")
    example: str = Field("", description="教学示例/案例（具体题目或场景）")


class SessionPlan(BaseModel):
    """单课时教学计划。"""
    session_order: int = Field(..., description="第几课时")
    session_topic: str = Field(..., description="本课时主题")
    objectives: list[TeachingObjective] = Field(default_factory=list)
    key_points: list[str] = Field(default_factory=list, description="教学重点")
    difficult_points: list[str] = Field(default_factory=list, description="教学难点")
    activities: list[TeachingActivity] = Field(default_factory=list)
    homework: str = Field("", description="课后作业与思考题")


class LessonPlanResponse(BaseModel):
    """完整教案响应。"""
    id: str = ""
    course_name: str
    chapter: str
    total_hours: int
    objectives: list[TeachingObjective] = Field(default_factory=list)
    methods: list[str] = Field(default_factory=list, description="教学方法")
    resources: list[str] = Field(default_factory=list, description="教学资源与工具")
    sessions: list[SessionPlan] = Field(default_factory=list)
    # LLM 生成的辅助模块（之前被丢弃，现已恢复）
    board_design: dict = Field(default_factory=dict, description="板书设计")
    class_tasks: list[dict] = Field(default_factory=list, description="分层课堂任务")
    homework: list[dict] = Field(default_factory=list, description="分层课后作业")
    assessment: dict = Field(default_factory=dict, description="考核标准与评价量规")
    innovation: dict = Field(default_factory=dict, description="教学创新设计")
    learner_analysis: dict = Field(default_factory=dict, description="学情分析")
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    is_fallback: bool = Field(False, description="是否为降级方案（LLM生成失败时的备用模板）")


class LessonPlanListResponse(BaseModel):
    """教案列表。"""
    plans: list[LessonPlanResponse] = Field(default_factory=list)
    total: int = 0


# ═══════════════════════════════════════════════════════════
#  2. 作业批改与辅导 (Homework Grading)
# ═══════════════════════════════════════════════════════════

class HomeworkSubmission(BaseModel):
    """学生作业提交。"""
    homework_id: str = ""
    student_name: str = Field("未知学生", description="学生姓名")
    course_name: str = Field("", description="课程名称")
    chapter: str = Field("", description="所属章节")
    question_text: str = Field("", description="题目内容")
    student_answer: str = Field("", description="学生答案")
    reference_answer: str = Field("", description="参考答案（可选）")
    question_type: str = Field("主观题", description="题目类型：选择题/填空题/主观题/计算题/论述题")
    max_score: float = Field(100.0, ge=1, description="满分")


class GradingResult(BaseModel):
    """批改结果。"""
    score: float = Field(..., ge=0, description="得分")
    max_score: float
    percentage: float = Field(0, ge=0, le=100, description="得分百分比")
    feedback: str = Field(..., description="综合评语")
    strengths: list[str] = Field(default_factory=list, description="优点")
    weaknesses: list[str] = Field(default_factory=list, description="不足与错误")
    suggestions: list[str] = Field(default_factory=list, description="改进建议")
    knowledge_points: list[str] = Field(default_factory=list, description="涉及知识点")
    detailed_analysis: str = Field("", description="逐句/逐步详细分析")
    scoring_breakdown: list[dict] = Field(default_factory=list, description="分步评分明细")


class BatchGradingRequest(BaseModel):
    """批量批改请求。"""
    submissions: list[HomeworkSubmission] = Field(..., min_length=1, max_length=50)


class ArchiveResultsRequest(BaseModel):
    """归档批改结果请求。"""
    results: list[dict] = Field(..., min_length=1)


class BatchGradingResponse(BaseModel):
    """批量批改响应。"""
    results: list[GradingResult] = Field(default_factory=list)
    total_submissions: int = 0
    avg_score: float = 0
    class_distribution: dict[str, int] = Field(default_factory=dict)


class ExerciseRequest(BaseModel):
    """生成针对性练习题请求。"""
    course_name: str = Field(..., description="课程名称")
    chapter: str = Field("", description="章节")
    knowledge_points: list[str] = Field(..., description="知识点列表")
    difficulty: str = Field("中等", description="难度：简单/中等/困难")
    count: int = Field(5, ge=1, le=20, description="题目数量")
    types: list[str] = Field(
        default_factory=lambda: ["选择题", "填空题", "简答题"],
        description="题目类型",
    )


class ExerciseItem(BaseModel):
    """单个练习题。"""
    question: str = Field(..., description="题目内容")
    type: str = Field("选择题", description="题目类型")
    options: list[str] = Field(default_factory=list, description="选择题选项")
    answer: str = Field("", description="参考答案")
    difficulty: str = Field("中等", description="难度")
    knowledge_point: str = Field("", description="所属知识点")
    explanation: str = Field("", description="详细解析")
    estimated_time: int = Field(5, description="预计完成时间（分钟）")


class ExerciseResponse(BaseModel):
    """练习题生成响应。"""
    exercises: list[ExerciseItem] = Field(default_factory=list)
    course_name: str
    chapter: str = ""
    total: int = 0
    difficulty_distribution: dict[str, int] = Field(default_factory=dict)


# ═══════════════════════════════════════════════════════════
#  3. 学情精准洞察 (Student Insight)
# ═══════════════════════════════════════════════════════════

class KnowledgeMastery(BaseModel):
    """知识点掌握度。"""
    name: str = Field(..., description="知识点名称")
    mastery: float = Field(..., ge=0, le=100, description="掌握度 (0-100)")
    trend: str = Field("稳定", description="趋势：上升/下降/稳定")
    practice_count: int = Field(0, description="练习次数")
    avg_score: float = Field(0, description="平均得分")
    category: str = Field("", description="知识分类")


class StudentProfile(BaseModel):
    """学生基础信息。"""
    student_id: str
    name: str
    course: str
    grade: str = ""
    class_name: str = ""


class PerformanceRecord(BaseModel):
    """单次成绩记录。"""
    date: str = ""
    exam_name: str = ""
    score: float
    total_score: float = 100
    category: str = "考试"  # 考试 / 作业 / 练习


class StudentInsightRequest(BaseModel):
    """学情分析请求。"""
    student_id: str = Field(..., description="学生ID")
    student_name: str = ""
    course_name: str = Field(..., description="课程名称")
    records: list[PerformanceRecord] = Field(default_factory=list)


class StudentInsightResponse(BaseModel):
    """学情分析报告。"""
    student_id: str
    student_name: str = ""
    course_name: str
    profile: StudentProfile | None = None

    # 综合指标
    overall_score: float = 0
    completion_rate: float = 0
    ranking: str = ""
    trend_description: str = ""

    # 知识掌握
    knowledge_mastery: list[KnowledgeMastery] = Field(default_factory=list)
    weak_points: list[str] = Field(default_factory=list)
    strong_points: list[str] = Field(default_factory=list)

    # 成绩趋势
    score_history: list[PerformanceRecord] = Field(default_factory=list)

    # 预警与建议
    warnings: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    attention_needed: bool = False

    # 图表数据
    radar_data: list[dict] = Field(default_factory=list)
    trend_data: list[dict] = Field(default_factory=list)

    # 是否由 AI 生成（False 表示使用了备用数据）
    ai_generated: bool = True


class ClassInsightRequest(BaseModel):
    """班级整体学情分析请求。"""
    course_name: str = Field(..., description="课程名称")
    students: list[StudentInsightRequest] = Field(default_factory=list)


class ClassInsightResponse(BaseModel):
    """班级整体学情报告。"""
    course_name: str
    student_count: int = 0
    class_avg_score: float = 0
    pass_rate: float = 0
    excellent_rate: float = 0
    distribution: dict[str, int] = Field(default_factory=dict)
    weak_points_ranking: list[dict] = Field(default_factory=list)
    attention_list: list[dict] = Field(default_factory=list)


# ═══════════════════════════════════════════════════════════
#  4. 知识库 (Knowledge Base)
# ═══════════════════════════════════════════════════════════

class DocumentChunk(BaseModel):
    """文档切片。"""
    id: str = ""
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    source: str = ""
    score: float = 0.0


class SearchRequest(BaseModel):
    """知识库检索请求。"""
    query: str = Field(..., description="查询内容")
    top_k: int = Field(5, ge=1, le=20)
    course_name: str = ""
    chapter: str = ""
    filter_criteria: dict[str, Any] = Field(default_factory=dict)


class SearchResponse(BaseModel):
    """知识库检索响应。"""
    results: list[DocumentChunk] = Field(default_factory=list)
    total_found: int = 0
    query: str = ""


class KnowledgeBaseStatus(BaseModel):
    """知识库状态。"""
    total_chunks: int = 0
    total_documents: int = 0
    courses: list[str] = Field(default_factory=list)
    last_updated: str = ""
    vector_db_path: str = ""
    storage: str = ""


# ═══════════════════════════════════════════════════════════
#  5. 通用
# ═══════════════════════════════════════════════════════════

class APIResponse(BaseModel):
    """通用API响应。"""
    success: bool = True
    message: str = ""
    data: Any = None


class ChatRequest(BaseModel):
    """对话请求。"""
    message: str = Field(..., description="用户消息")
    context: str = Field("", description="上下文（可选）")
    course: str = Field("", description="关联课程")
    use_rag: bool = Field(True, description="是否使用知识库增强")


# ═══════════════════════════════════════════════════════════
#  6. 师生通信 (Messaging)
# ═══════════════════════════════════════════════════════════

class CreateConversationRequest(BaseModel):
    """创建会话请求。"""
    title: str = Field("新对话", description="会话标题")
    student_name: str = Field(..., description="学生名称")
    teacher_name: str = Field(..., description="教师名称")


class SendMessageRequest(BaseModel):
    """发送消息请求。"""
    conversation_id: str = Field(..., description="会话ID")
    sender_name: str = Field(..., description="发送者名称")
    sender_role: str = Field(..., description="发送者角色: student / teacher")
    content: str = Field(..., min_length=1, max_length=10000, description="消息内容")


class MessageResponse(BaseModel):
    """消息条目。"""
    id: int
    conversation_id: str
    sender_name: str
    sender_role: str
    content: str
    is_read: bool
    created_at: str


class ConversationResponse(BaseModel):
    """会话条目。"""
    id: str
    title: str
    student_name: str
    teacher_name: str
    last_message: str = ""
    unread_count: int = 0
    created_at: str
    updated_at: str


class ConversationListResponse(BaseModel):
    """会话列表响应。"""
    conversations: list[ConversationResponse]
    total: int


class MessageListResponse(BaseModel):
    """消息列表响应。"""
    messages: list[MessageResponse]
    total: int


class UnreadCountResponse(BaseModel):
    """未读消息计数。"""
    unread_count: int = 0


# ═══════════════════════════════════════════════════════════
#  7. 作业管理
# ═══════════════════════════════════════════════════════════

class AssignmentPublishRequest(BaseModel):
    """发布作业请求。"""
    course_id: str = ""
    course_name: str = Field(..., description="课程名称")
    teacher_name: str = Field(..., description="教师名称")
    title: str = Field(..., min_length=1, max_length=200)
    content: str = ""
    deadline: str = ""
    selected_students: list[str] = Field(default_factory=list)
    attachments: list[str] = Field(default_factory=list)
    question_ids: list[str] = Field(default_factory=list)


class AssignmentUpdateRequest(BaseModel):
    """更新作业请求。"""
    title: str = Field("", max_length=200)
    content: str = ""
    deadline: str = ""
    status: str = ""


class SubmissionSubmitRequest(BaseModel):
    """学生提交作业请求。"""
    student_name: str = Field(..., description="学生名称")
    content: str = ""
    files: list[str] = Field(default_factory=list)


class SubmissionGradeRequest(BaseModel):
    """批改打分请求。"""
    score: float = Field(0, ge=0, le=100)
    feedback: str = ""
    graded_by: str = ""
