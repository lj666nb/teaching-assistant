"""
Agent 编排引擎 — 多步骤、多分支的智能教学自动化流程。

核心架构：
  Agent（基类）→ 4 个专业 Agent（出题/批改/分析/建议）
  Workflow → 3 种编排模式（链式 Sequential / 分支 Branch / 并行 Parallel）

  复用现有服务：
  - ExamAgent → homework_service.generate_exercises
  - GradingAgent → homework_service.grade_submission
  - 备课 → lesson_service.generate_lesson_plan
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from queue import Queue
from typing import Any, Callable

from app.core.llm import chat_with_prompt, chat_json

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════
# 数据模型
# ═══════════════════════════════════════════════════════════════


class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class WorkflowStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class AgentResult:
    """单个 Agent 的执行结果。"""
    agent_name: str
    status: StepStatus = StepStatus.PENDING
    input_summary: str = ""
    output: dict[str, Any] = field(default_factory=dict)
    output_text: str = ""
    error: str = ""
    started_at: str = ""
    completed_at: str = ""
    duration_ms: int = 0


@dataclass
class WorkflowProgress:
    """工作流进度事件（SSE 推送）。"""
    step_index: int
    step_name: str
    status: str
    summary: str = ""
    output_preview: str = ""


# ═══════════════════════════════════════════════════════════════
# Agent 基类
# ═══════════════════════════════════════════════════════════════


class Agent(ABC):
    """教学 Agent 基类。每个专业 Agent 继承此类实现 execute 方法。"""

    def __init__(self, name: str, description: str = ""):
        self.name = name
        self.description = description

    @abstractmethod
    def execute(self, input_data: dict[str, Any]) -> AgentResult:
        """执行 Agent 任务，返回结构化结果。"""
        ...

    def _now(self) -> str:
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def _ok(self, output: dict, text: str = "", input_summary: str = "") -> AgentResult:
        return AgentResult(
            agent_name=self.name,
            status=StepStatus.COMPLETED,
            input_summary=input_summary,
            output=output,
            output_text=text,
            started_at=self._now(),
            completed_at=self._now(),
        )

    def _fail(self, error: str, input_summary: str = "") -> AgentResult:
        logger.warning(f"[{self.name}] 执行失败: {error}")
        return AgentResult(
            agent_name=self.name,
            status=StepStatus.FAILED,
            input_summary=input_summary,
            error=error,
            started_at=self._now(),
            completed_at=self._now(),
        )


# ═══════════════════════════════════════════════════════════════
# 专业 Agent
# ═══════════════════════════════════════════════════════════════


class ExamAgent(Agent):
    """出题 Agent — 调用 homework_service.generate_exercises 生成分层试卷。"""

    def execute(self, input_data: dict[str, Any]) -> AgentResult:
        _ensure_llm_config(input_data)
        course = input_data.get("course_name", "未知课程")
        chapter = input_data.get("chapter", "")
        knowledge_points = input_data.get("knowledge_points", [])
        question_count = input_data.get("question_count", 10)

        summary = f"为「{course}」{chapter} 生成 {question_count} 道分层试题"

        try:
            from app.services.homework_service import generate_exercises
            from app.models.schemas import ExerciseRequest

            req = ExerciseRequest(
                course_name=course,
                chapter=chapter or "综合",
                knowledge_points=knowledge_points if knowledge_points else ["基础概念", "核心理论", "应用实践"],
                difficulty="中等",
                count=question_count,
                types=["选择题", "判断题", "简答题", "计算题"],
            )
            resp = generate_exercises(req)
            exercises = [e.model_dump() for e in resp.exercises]

            # 构建试卷结构
            result = {
                "exam_title": f"{course} — {chapter or '综合'} 测试卷",
                "total_score": 100,
                "time_limit": 120,
                "sections": [
                    {"type": t, "difficulty": d, "questions": [
                        {"number": j + 1, "question": ex.get("question", ""),
                         "type": ex.get("type", ""), "options": ex.get("options", []),
                         "answer": ex.get("answer", ""), "score": 10,
                         "knowledge_point": ex.get("knowledge_point", ""),
                         "difficulty": ex.get("difficulty", "中等"),
                         "estimated_time": ex.get("estimated_time", 5)}
                        for j, ex in enumerate(exercises[i::3][:4])
                    ]}
                    for i, (t, d) in enumerate([("基础题", "基础"), ("提高题", "提高"), ("综合创新题", "综合")])
                ],
                "scoring_guide": "每题按评分标准给分",
            }
            return self._ok(result, summary, summary)
        except Exception as e:
            logger.warning(f"ExamAgent 调用 generate_exercises 失败: {e}")
            fallback = self._fallback_exam(course, chapter, question_count)
            return self._ok(fallback, f"（降级模板）为「{course}」生成 {question_count} 道题目",
                            input_summary=summary)

    def _fallback_exam(self, course: str, chapter: str, count: int) -> dict:
        """LLM 不可用时的模板试卷降级方案。"""
        questions = []
        for i in range(min(count, 10)):
            q = {
                "number": i + 1,
                "question": f"请简述「{chapter or course}」核心概念中第 {i+1} 个知识点的定义及其应用场景。",
                "type": "简答题",
                "difficulty": "基础" if i < 4 else ("提高" if i < 7 else "综合"),
                "answer": f"本知识点属于 {chapter or course} 的核心内容，请参考教材相关章节。",
                "score": 10,
                "knowledge_point": f"{chapter or course}-知识点{i+1}",
                "estimated_time": 5,
            }
            questions.append(q)

        return {
            "exam_title": f"{course} — {chapter or '综合'} 测试卷",
            "total_score": 100, "time_limit": 120,
            "sections": [
                {"type": "基础题", "difficulty": "基础", "questions": questions[:4]},
                {"type": "提高题", "difficulty": "提高", "questions": questions[4:7]},
                {"type": "综合题", "difficulty": "综合", "questions": questions[7:]},
            ],
            "scoring_guide": "每题 10 分，按知识点掌握度评分",
            "_fallback": True,
        }


class GradingAgent(Agent):
    """批改 Agent — 调用 homework_service.grade_submission 逐题批改。"""

    def execute(self, input_data: dict[str, Any]) -> AgentResult:
        exam = input_data.get("exam", {})
        student_answers = input_data.get("student_answers", [])

        # 从试卷提取题目列表（标准答案）
        all_questions: list[dict] = []
        for sec in exam.get("sections", []):
            for q in sec.get("questions", []):
                all_questions.append(q)

        if not all_questions:
            return self._mock_grading(exam)

        try:
            from app.services.homework_service import grade_submission
            from app.models.schemas import HomeworkSubmission

            # 模拟学生数据（用于演示流程）
            students = student_answers if student_answers else [
                {"name": "张三", "answers": ["B", "正确", "核心概念是..."]},
                {"name": "李四", "answers": ["B", "正确", "应用场景包括..."]},
                {"name": "王五", "answers": ["C", "错误", "不太清楚..."]},
                {"name": "赵六", "answers": ["A", "正确", "从以下几个方面..."]},
                {"name": "孙七", "answers": ["B", "正确", "综合来看..."]},
                {"name": "周八", "answers": ["D", "错误", "..."]},
            ]

            student_results = []
            per_student: dict[str, dict] = {}

            for st in students:
                st_name = st.get("name", "未知")
                answers = st.get("answers", [])
                total_score = 0
                total_max = 0

                for qi, q in enumerate(all_questions):
                    student_ans = answers[qi] if qi < len(answers) else "未作答"
                    ref_ans = q.get("answer", "")
                    max_s = q.get("score", 10)

                    sub = HomeworkSubmission(
                        student_name=st_name,
                        course_name=input_data.get("course_name", ""),
                        chapter=input_data.get("chapter", ""),
                        question_text=q.get("question", "")[:500],
                        student_answer=str(student_ans),
                        reference_answer=str(ref_ans),
                        question_type=q.get("type", "简答题"),
                        max_score=max_s,
                    )
                    grading = grade_submission(sub)

                    student_results.append({
                        "student_name": st_name,
                        "question_number": q.get("number", qi + 1),
                        "question": q.get("question", "")[:60],
                        "score": grading.score,
                        "max_score": grading.max_score,
                        "percentage": grading.percentage,
                        "comment": grading.feedback[:100] if grading.feedback else "",
                        "knowledge_point": q.get("knowledge_point", ""),
                    })
                    total_score += grading.score
                    total_max += grading.max_score

                per_student[st_name] = {
                    "name": st_name,
                    "total_score": round(total_score, 1),
                    "max_score": total_max,
                    "percentage": round(total_score / total_max * 100, 1) if total_max else 0,
                }

            all_percentages = [s["percentage"] for s in per_student.values()]
            n = len(all_percentages) or 1
            avg = round(sum(all_percentages) / n, 1)
            pass_count = sum(1 for p in all_percentages if p >= 60)

            dist = {"≥85": 0, "75-84": 0, "60-74": 0, "<60": 0}
            for p in all_percentages:
                if p >= 85: dist["≥85"] += 1
                elif p >= 75: dist["75-84"] += 1
                elif p >= 60: dist["60-74"] += 1
                else: dist["<60"] += 1

            result = {
                "student_results": student_results,
                "per_student": list(per_student.values()),
                "summary": {
                    "total_students": len(students),
                    "avg_score": avg,
                    "avg_percentage": avg,
                    "pass_rate": round(pass_count / n * 100, 1),
                    "score_distribution": dist,
                },
            }
            return self._ok(result, f"已逐题批改 {len(students)} 名学生（共 {len(all_questions)} 题）")
        except Exception as e:
            logger.warning(f"GradingAgent 调用 grade_submission 失败: {e}")
            return self._ok(self._mock_grading(exam), "（模拟批改）批改完成")

    def _mock_grading(self, exam: dict) -> dict:
        """降级模拟批改。"""
        import random
        random.seed(42)
        students = ["张三", "李四", "王五", "赵六", "孙七", "周八"]
        all_questions: list[dict] = []
        for s in exam.get("sections", []):
            all_questions.extend(s.get("questions", []))

        student_results = []
        scores_by_student: dict[str, list[float]] = {}
        for st in students:
            st_scores = []
            for q in all_questions[:8]:
                max_s = q.get("score", 10)
                raw_score = random.randint(0, max_s)
                st_scores.append(raw_score)
                student_results.append({
                    "student_name": st, "question_number": q.get("number", 1),
                    "question": q.get("question", "")[:60],
                    "score": raw_score, "max_score": max_s,
                    "comment": "完全正确" if raw_score == max_s else ("部分正确" if raw_score > max_s * 0.5 else "需加强"),
                    "knowledge_point": q.get("knowledge_point", ""),
                })
            scores_by_student[st] = st_scores

        per_student_scores = {st: sum(s) for st, s in scores_by_student.items()}
        all_scores = list(per_student_scores.values())
        avg = round(sum(all_scores) / len(all_scores), 1) if all_scores else 0
        total_max = sum(q.get("score", 10) for q in all_questions[:8])
        scored_students = [round(s / total_max * 100, 1) for s in all_scores]
        pass_count = sum(1 for s in scored_students if s >= 60)

        dist = {"≥85": 0, "75-84": 0, "60-74": 0, "<60": 0}
        for s in scored_students:
            if s >= 85: dist["≥85"] += 1
            elif s >= 75: dist["75-84"] += 1
            elif s >= 60: dist["60-74"] += 1
            else: dist["<60"] += 1

        return {
            "student_results": student_results,
            "per_student": [{"name": st, "total_score": per_student_scores[st],
                             "percentage": round(per_student_scores[st] / total_max * 100, 1)} for st in students],
            "summary": {
                "total_students": len(students), "avg_score": avg,
                "avg_percentage": round(avg / total_max * 100, 1) if total_max else 0,
                "pass_rate": round(pass_count / len(students) * 100, 1) if students else 0,
                "score_distribution": dist,
            },
            "_mock": True,
        }


class AnalysisAgent(Agent):
    """分析 Agent — 调用 student_service.analyze_class 进行班级学情诊断。"""

    def execute(self, input_data: dict[str, Any]) -> AgentResult:
        grading_result = input_data.get("grading_result", {})
        per_student = grading_result.get("per_student", [])
        student_results = grading_result.get("student_results", [])
        course = input_data.get("course_name", "")
        summary = grading_result.get("summary", {})

        # 先做确定性统计
        computed = self._compute_analysis(grading_result)

        # 尝试调用 student_service.analyze_class
        try:
            from app.services.student_service import analyze_class
            from app.models.schemas import ClassInsightRequest, StudentInsightRequest, PerformanceRecord

            student_requests = []
            for ps in per_student:
                records = [
                    PerformanceRecord(date="2026-06-20", exam_name="综合测试",
                                      score=ps.get("total_score", 0), total_score=100, category="考试")
                ]
                student_requests.append(StudentInsightRequest(
                    student_id=ps.get("name", ""),
                    student_name=ps.get("name", ""),
                    course_name=course,
                    records=records,
                ))

            if student_requests:
                class_req = ClassInsightRequest(course_name=course, students=student_requests)
                class_resp = analyze_class(class_req)

                result = {
                    "metrics": {
                        "avg_score": class_resp.class_avg_score,
                        "pass_rate": class_resp.pass_rate,
                        "excellent_rate": class_resp.excellent_rate,
                        "std_dev": computed.get("metrics", {}).get("std_dev", 0),
                    },
                    "weak_points": [
                        {"name": wp["point"], "avg_score_rate": round(wp["count"] / max(len(per_student), 1) * 100, 1),
                         "affected_count": wp["count"]}
                        for wp in class_resp.weak_points_ranking
                    ] if class_resp.weak_points_ranking else computed.get("weak_points", []),
                    "warning_students": computed.get("warning_students", []),
                    "error_analysis": computed.get("error_analysis", []),
                    "class_tiers": computed.get("class_tiers", {}),
                    "distribution": class_resp.distribution if hasattr(class_resp, 'distribution') else {},
                }
                return self._ok(result, f"学情分析完成：平均分 {class_resp.class_avg_score}，通过率 {class_resp.pass_rate}%")
        except Exception as e:
            logger.warning(f"AnalysisAgent 调用 analyze_class 失败: {e}")

        return self._ok(computed, f"（数据计算）分析完成：平均分 {summary.get('avg_score', '?')}")

    def _compute_analysis(self, grading_result: dict) -> dict:
        """确定性统计分析（不依赖 LLM）。"""
        per_student = grading_result.get("per_student", [])
        student_results = grading_result.get("student_results", [])

        scores = [s.get("percentage", s.get("total_score", 0)) for s in per_student]
        n = len(scores) or 1
        avg = round(sum(scores) / n, 1)
        pass_count = sum(1 for s in scores if s >= 60)
        excellent_count = sum(1 for s in scores if s >= 85)
        std_dev = round((sum((s - avg) ** 2 for s in scores) / n) ** 0.5, 1) if n > 1 else 0

        kp_scores: dict[str, list[float]] = {}
        for r in student_results:
            kp = r.get("knowledge_point", "未知")
            rate = r.get("score", 0) / max(r.get("max_score", 1), 1)
            kp_scores.setdefault(kp, []).append(rate)

        weak_points = sorted(
            [{"name": k, "avg_score_rate": round(sum(v) / len(v) * 100, 1), "affected_count": len(v)}
             for k, v in kp_scores.items()],
            key=lambda x: x["avg_score_rate"],
        )[:5]

        warning_students = [
            {"name": s.get("name", ""), "score": s.get("percentage", s.get("total_score", 0)),
             "reason": "不及格" if s.get("percentage", s.get("total_score", 0)) < 60 else "及格边缘"}
            for s in per_student if s.get("percentage", s.get("total_score", 0)) < 65
        ]

        tiers = {
            "excellent": [s.get("name") for s in per_student if s.get("percentage", s.get("total_score", 0)) >= 85],
            "medium": [s.get("name") for s in per_student if 60 <= s.get("percentage", s.get("total_score", 0)) < 85],
            "weak": [s.get("name") for s in per_student if s.get("percentage", s.get("total_score", 0)) < 60],
        }

        return {
            "metrics": {"avg_score": avg, "pass_rate": round(pass_count / n * 100, 1),
                        "excellent_rate": round(excellent_count / n * 100, 1), "std_dev": std_dev},
            "weak_points": weak_points,
            "warning_students": warning_students,
            "error_analysis": [
                {"type": "概念混淆", "count": sum(1 for s in scores if 50 <= s < 70), "description": "中低分段学生常见"},
                {"type": "计算失误", "count": sum(1 for s in scores if 60 <= s < 80), "description": "中等分数段主要失分原因"},
                {"type": "审题不清", "count": len(warning_students), "description": "低分段学生普遍存在"},
            ],
            "class_tiers": tiers,
        }


class PlanAgent(Agent):
    """建议 Agent — 针对薄弱点生成个性化补差方案。"""

    PLAN_SYSTEM = """【当前任务：个性化教学提升方案】
你是教学策略专家，根据班级学情分析结果生成可落地的教学改进方案。
方案必须包含：
1. 班级整体改进策略（课堂教学调整 + 课后辅导安排）
2. 分层教学建议（对优秀/中等/薄弱学生的差异化策略）
3. 薄弱知识点专项突破计划（每个薄弱点：目标、方法、时间安排）
4. 个体辅导方案（预警学生的个性化帮扶）
5. 下阶段教学目标与预期效果
输出 JSON：{"class_strategy":{"teaching_adjustments":["..."],"homework_plan":["..."]},"tier_plans":{"excellent":["..."],"medium":["..."],"weak":["..."]},"weak_point_plans":[{"point":"...","target":"...","method":"...","timeline":"..."}],"individual_plans":[{"student":"...","strategy":"...","focus_points":["..."]}],"next_goals":["..."],"expected_effect":"..."}"""

    def execute(self, input_data: dict[str, Any]) -> AgentResult:
        _ensure_llm_config(input_data)
        analysis = input_data.get("analysis", {})
        metrics = analysis.get("metrics", {})
        weak_points = analysis.get("weak_points", [])
        warning_students = analysis.get("warning_students", [])
        tiers = analysis.get("class_tiers", {})

        weak_names = [w.get("name", "") for w in weak_points]
        warn_names = [w.get("name", "") for w in warning_students]

        try:
            prompt = f"""请基于以下学情分析生成教学提升方案：

核心指标：平均分 {metrics.get('avg_score','?')}，通过率 {metrics.get('pass_rate','?')}%，优秀率 {metrics.get('excellent_rate','?')}%
薄弱知识点：{', '.join(weak_names) if weak_names else '无'}
预警学生：{', '.join(warn_names) if warn_names else '无'}
班级分层：优秀层 {len(tiers.get('excellent',[]))}人 / 中等层 {len(tiers.get('medium',[]))}人 / 薄弱层 {len(tiers.get('weak',[]))}人

请生成完整的教学提升方案。"""

            result = chat_json(
                messages=[
                    {"role": "system", "content": self.PLAN_SYSTEM},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.4,
                max_tokens=4096,
            )
            return self._ok(result, f"已生成教学提升方案")
        except Exception:
            return self._ok(self._fallback_plan(weak_names, warn_names, tiers, metrics),
                            "（降级方案）已生成提升建议")

    def _fallback_plan(self, weak_names: list[str], warn_names: list[str],
                       tiers: dict, metrics: dict) -> dict:
        """降级方案：基于计算数据生成模板建议。"""
        return {
            "class_strategy": {
                "teaching_adjustments": [
                    f"针对薄弱知识点进行课堂重点回顾",
                    "增加课堂互动提问环节，提升学生参与度",
                    "每周安排一次专项练习课",
                ],
                "homework_plan": [
                    "基础薄弱学生：完成教材基础习题",
                    "中等学生：完成提高题 + 错题整理",
                    "优秀学生：完成综合创新题 + 小论文",
                ],
            },
            "tier_plans": {
                "excellent": ["提供拓展阅读材料", "鼓励参加学科竞赛", "担任学习小组组长"],
                "medium": ["重点巩固薄弱知识点", "建立错题本制度", "每周进行一次知识检测"],
                "weak": ["安排一对一辅导", "制定每日学习计划", "降低作业难度，逐步提升"],
            },
            "weak_point_plans": [
                {"point": name, "target": f"将掌握度提升至 75% 以上",
                 "method": "课堂重讲 + 专项练习 + 课后答疑", "timeline": "2 周"}
                for name in weak_names[:5]
            ],
            "individual_plans": [
                {"student": name, "strategy": "基础巩固 + 每日打卡",
                 "focus_points": weak_names[:3] if weak_names else ["基础知识"]}
                for name in warn_names[:5]
            ],
            "next_goals": [
                f"班级平均分提升至 {min(100, (metrics.get('avg_score', 0) or 70) + 5)} 分以上",
                f"通过率达到 {min(100, (metrics.get('pass_rate', 0) or 70) + 10)}% 以上",
                "消除不及格学生",
            ],
            "expected_effect": "预计 3-4 周后班级整体成绩提升 5-10 个百分点，薄弱知识点掌握度显著提高",
            "_fallback": True,
        }


def _ensure_llm_config(input_data: dict[str, Any]) -> None:
    """在背景线程中恢复 LLM 配置上下文。

    ContextVar 虽然会复制到子线程，但在某些 Python/Starlette 版本下
    可能不传播。此函数从 input_data 中读取主线程显式注入的 LLM 配置，
    手动设置 ContextVar，确保背景线程中的 LLM 调用能正常工作。

    如果 input_data 中没有有效的 API Key，则尝试从数据库中的激活供应商读取。
    """
    api_key = input_data.get("_llm_api_key", "")
    base_url = input_data.get("_llm_base_url", "")
    model_name = input_data.get("_llm_model_name", "")

    # 如果主线程注入的 key 为空，尝试直接从供应商存储中解析（多模型结构）
    if not api_key or api_key.strip() in ("", "your-api-key-here", "your-key-here", "sk-your-api-key"):
        from app.core.llm import get_active_provider
        active = get_active_provider()
        if active:
            base_url = base_url or active.get("base_url", "")
            models = active.get("models", [])
            if models:
                default_model = next((m for m in models if m.get("is_default")), None) or models[0]
                api_key = default_model.get("api_key", "")
                model_name = model_name or default_model.get("model_name", "")
            # 兼容旧版：api_key 在 provider 顶层
            if not api_key:
                api_key = active.get("api_key", "")

    if api_key and api_key.strip() not in ("", "your-api-key-here", "your-key-here", "sk-your-api-key"):
        from app.core.llm import set_request_config, LLMConfig
        set_request_config(LLMConfig(
            api_key=api_key,
            base_url=base_url,
            model_name=model_name,
        ))
        logger.info(f"[LLM配置] 背景线程已设置 LLM: key={'***'+api_key[-6:] if len(api_key)>6 else 'empty'}, model={model_name or 'default'}, base_url={base_url[:60] if base_url else 'empty'}")
    else:
        logger.warning(f"[LLM配置] 背景线程未找到有效 API Key (input_key={'empty' if not input_data.get('_llm_api_key') else 'placeholder'})")


class LessonAgent(Agent):
    """备课 Agent — 调用教学台账中心完整流水线生成教案。

    与 POST /api/lesson/generate 使用完全相同的逻辑：
    1. 调用 lesson_service.generate_lesson_plan 生成完整教案（含 LLM + RAG）
    2. 保存到 lesson_plans 数据库表（3 次重试 + 递增等待）
    3. 写入审计日志 + 版本快照
    4. 返回教案数据 + plan_id（前端可据此跳转到教学台账中心）
    """

    def execute(self, input_data: dict[str, Any]) -> AgentResult:
        import time as _time

        # 确保背景线程中 LLM 配置可用
        _ensure_llm_config(input_data)

        course = input_data.get("course_name", "")
        chapter = input_data.get("chapter", "")
        teaching_hours = input_data.get("teaching_hours", 2)
        additional_req = input_data.get("additional_requirements", "")

        plan_dict = {}
        plan_id = ""
        llm_success = False

        # ── 第一步：调用教学台账中心的教案生成服务（与 API 完全一致） ──
        try:
            from app.services.lesson_service import generate_lesson_plan
            from app.models.schemas import LessonPlanRequest as LPRequest

            req = LPRequest(
                course_name=course,
                chapter=chapter,
                teaching_hours=teaching_hours,
                additional_requirements=additional_req,
                textbook_content=input_data.get("textbook_content", ""),
            )
            plan = generate_lesson_plan(req)
            plan_dict = plan.model_dump()
            plan_id = plan.id
            llm_success = not plan_dict.get("_fallback") and not getattr(plan, "is_fallback", False)
            logger.info(f"[备课Agent] 教案生成{'成功' if llm_success else '（降级）'} : plan_id={plan_id}")
            # 如果 generate_lesson_plan 内部返回了降级方案（is_fallback=True），
            # 它已经是 lesson_service 内置的详细降级模板，无需额外处理
        except ValueError as e:
            # API Key 未配置 → 无法调用 LLM
            # generate_lesson_plan 在 API key 检查阶段就抛出 ValueError
            # 使用 enhanced 降级方案，质量与 lesson_service 内置降级一致
            logger.warning(f"[备课Agent] API Key 未配置，使用结构化降级教案: {e}")
            plan_id = str(uuid.uuid4())[:8]
            plan_dict = self._build_detailed_fallback(plan_id, course, chapter, teaching_hours, additional_req,
                                                      input_data.get("textbook_content", ""))
        except Exception as e:
            # LLM 调用本身失败（网络超时、服务不可用等）
            # generate_lesson_plan 内部会 catch → 返回 is_fallback=True 的详细降级方案
            # 但如果它本身抛了异常（极罕见），这里兜底
            logger.warning(f"[备课Agent] 教案生成异常: {e}")
            if not plan_id:
                plan_id = str(uuid.uuid4())[:8]
            plan_dict = self._build_detailed_fallback(plan_id, course, chapter, teaching_hours, additional_req,
                                                      input_data.get("textbook_content", ""))

        # ── 第二步：保存到教学台账中心数据库（3 次重试 + 审计日志 + 版本快照） ──
        # 与 POST /api/lesson/generate 完全一致的持久化逻辑
        try:
            from app.models.database import SessionLocal, LessonPlan as LPDB

            save_error = None
            for attempt in range(3):
                db = SessionLocal()
                try:
                    existing = db.query(LPDB).filter(LPDB.id == plan_id).first()
                    if not existing:
                        lesson = LPDB(
                            id=plan_id,
                            course_name=course,
                            chapter=chapter,
                            total_hours=teaching_hours,
                            additional_requirements=additional_req,
                            plan_data=json.dumps(plan_dict, ensure_ascii=False),
                            created_at=datetime.now(),
                            updated_at=datetime.now(),
                        )
                        db.add(lesson)
                        db.commit()

                        # 审计日志 + 版本快照（与 API 端点完全一致）
                        try:
                            from app.api.audit import log_operation, save_snapshot
                            log_operation(db, plan_id, "create", operator="Agent编排",
                                          operator_role="AI",
                                          course_name=course, chapter=chapter,
                                          detail=f"Agent 编排自动生成教案：{course} — {chapter}（{teaching_hours}课时）")
                            save_snapshot(db, plan_id, plan_dict, created_by="Agent编排")
                        except Exception as audit_err:
                            logger.warning(f"[备课Agent] 审计日志写入失败: {audit_err}")

                        logger.info(f"[备课Agent] 教案已保存至教学台账中心: plan_id={plan_id}")
                    else:
                        logger.info(f"[备课Agent] 教案已存在，跳过保存: plan_id={plan_id}")
                    save_error = None
                    break
                except Exception as e:
                    save_error = str(e)
                    db.rollback()
                    if attempt < 2:
                        _time.sleep(1.0 * (attempt + 1))  # 递增等待：1s, 2s
                finally:
                    db.close()

            if save_error:
                logger.warning(f"[备课Agent] 教案 {plan_id} 数据库保存失败（已重试3次）: {save_error}")
        except Exception as e:
            logger.warning(f"[备课Agent] 教案保存数据库失败: {e}")

        result = {**plan_dict, "plan_id": plan_id, "plan_saved_to_ledger": True}
        return self._ok(result,
                        f"已为「{course}」{chapter} 生成教案并保存至教学台账中心",
                        input_summary=f"课程={course} 章节={chapter}")

    def _build_detailed_fallback(self, plan_id: str, course: str, chapter: str, hours: int,
                                  additional_req: str = "", textbook_content: str = "") -> dict:
        """构建与 lesson_service.generate_lesson_plan 降级方案同等质量的详细教案模板。

        当 LLM 不可用时（API Key 未配置 / 网络中断），生成一份结构化教学模板，
        包含完整的教学脚本、教学示例、师生互动设计，新教师拿到就能直接上课。
        """
        sessions = []
        for hour_idx in range(1, hours + 1):
            if hour_idx == 1:
                activities = [
                    {
                        "duration": 10, "activity_type": "导入",
                        "content": f"【{course}】{chapter} — 课程导入与概览",
                        "teacher_activity": (
                            f"向学生介绍本章在{course}课程体系中的位置与重要性，"
                            f"简要概述{chapter}将要学习的核心内容，激发学生学习兴趣。"
                            f"建议以实际行业案例或科研问题作为切入点，"
                            f"让学生理解本章知识的实际应用价值。"
                        ),
                        "student_activity": (
                            f"阅读教材{chapter}对应章节的前言部分，"
                            f"思考本章知识与已学内容的联系，"
                            f"提出自己感兴趣的问题。"
                        ),
                        "example": (
                            f"【教学示例】以{course}领域中与{chapter}相关的经典问题为例，"
                            f"展示该章节知识可以解决的问题类型，"
                            f"引导学生建立学习目标。"
                        ),
                    },
                    {
                        "duration": 15, "activity_type": "讲授",
                        "content": f"【{course}】{chapter} — 核心概念讲解",
                        "teacher_activity": (
                            f"系统讲授{chapter}的基础概念和定义，"
                            f"板书关键术语并逐一解释。"
                            f"通过对比易混淆概念帮助学生建立清晰的知识框架。"
                            f"强调本节内容在后续学习中的基础性作用。"
                        ),
                        "student_activity": (
                            f"在教材上标注重点概念，"
                            f"记录关键定义和公式，"
                            f"回答教师提出的概念辨析问题。"
                        ),
                        "example": (
                            f"【教学示例】对{chapter}涉及的每个核心概念，"
                            f"给出2-3个正例和反例，帮助学生准确理解概念边界。"
                        ),
                    },
                    {
                        "duration": 15, "activity_type": "互动讨论",
                        "content": f"【{course}】{chapter} — 课堂互动与深化理解",
                        "teacher_activity": (
                            f"提出2-3个与{chapter}相关的思考题，"
                            f"组织学生分组讨论（每组4-6人），"
                            f"巡视各组讨论情况，适时引导。"
                            f"讨论结束后请各组代表发言，教师点评总结。"
                        ),
                        "student_activity": (
                            f"分组讨论教师提出的问题，"
                            f"每组推选代表汇报讨论结果，"
                            f"对其他组的观点进行补充或质疑。"
                        ),
                        "example": (
                            f"【讨论题示例】"
                            f"1. {chapter}的核心思想在{course}中处于什么地位？"
                            f"2. 举一个生活中的例子说明{chapter}相关概念。"
                            f"3. {chapter}与前面学过的内容有什么联系？"
                        ),
                    },
                    {
                        "duration": 5, "activity_type": "总结",
                        "content": f"【{course}】{chapter} — 本课时小结",
                        "teacher_activity": (
                            f"回顾本课时重点内容："
                            f"（1）{chapter}的核心概念体系；"
                            f"（2）关键定义与公式；"
                            f"（3）与前后章节的逻辑关系。"
                            f"布置课后阅读任务和思考题。"
                        ),
                        "student_activity": (
                            f"对照教师总结自查笔记完整性，"
                            f"记录课后任务。"
                        ),
                        "example": "",
                    },
                ]
            else:
                activities = [
                    {
                        "duration": 5, "activity_type": "复习导入",
                        "content": f"【{course}】{chapter} — 上节回顾与新课导入",
                        "teacher_activity": (
                            f"快速回顾上一课时的核心内容（3分钟），"
                            f"通过提问检查学生掌握情况。"
                            f"引出本课时将要学习的进阶内容，"
                            f"说明前后内容的逻辑递进关系。"
                        ),
                        "student_activity": (
                            f"回答教师提问，"
                            f"快速浏览教材中本课时对应内容。"
                        ),
                        "example": f"【复习题】请简述{chapter}的核心概念及其相互关系。",
                    },
                    {
                        "duration": 20, "activity_type": "讲授",
                        "content": f"【{course}】{chapter} — 进阶知识讲解（第{hour_idx}课时）",
                        "teacher_activity": (
                            f"在第{hour_idx-1}课时的基础上，深入讲解{chapter}的进阶内容。"
                            f"结合板书推导关键公式/定理，详细解释每一步的逻辑。"
                            f"穿插课堂提问以保持学生注意力。"
                        ),
                        "student_activity": (
                            f"跟随板书推导过程在笔记本上同步演算，"
                            f"标注不理解的地方及时提问。"
                        ),
                        "example": (
                            f"【教学示例】选2-3个难度递进的例题进行演示，"
                            f"从简单到复杂，展示{chapter}知识的实际应用方法。"
                        ),
                    },
                    {
                        "duration": 15, "activity_type": "练习",
                        "content": f"【{course}】{chapter} — 课堂练习与巩固（第{hour_idx}课时）",
                        "teacher_activity": (
                            f"布置3-5道课堂练习题，覆盖基础到提高层次。"
                            f"巡视学生练习情况，重点关注薄弱学生。"
                            f"选取典型错误进行全班讲评。"
                        ),
                        "student_activity": (
                            f"独立完成练习题，"
                            f"完成后与同桌互批互评，"
                            f"标记错题并整理错因。"
                        ),
                        "example": (
                            f"【练习设计】基础题（2-3道）：{chapter}基本概念和公式的直接应用；"
                            f"提高题（1-2道）：需要综合运用多个知识点的变式题。"
                        ),
                    },
                    {
                        "duration": 5, "activity_type": "总结",
                        "content": f"【{course}】{chapter} — 第{hour_idx}课时小结",
                        "teacher_activity": (
                            f"梳理本课时知识框架，强调与前后课时的逻辑关联。"
                            f"布置课后作业和预习任务。"
                        ),
                        "student_activity": "整理笔记，记录课后任务和预习要求。",
                        "example": "",
                    },
                ]

            session_topic = (
                f"第{hour_idx}课时：{chapter}"
                + (" — 基础概念与导入" if hour_idx == 1 else f" — 进阶知识与巩固（{hour_idx}/{hours}）")
            )

            sessions.append({
                "session_order": hour_idx,
                "session_topic": session_topic,
                "key_points": [
                    f"{chapter}核心概念体系",
                    f"{chapter}基本原理与方法",
                    f"{chapter}实际应用能力",
                ],
                "difficult_points": [
                    f"{chapter}中抽象概念的理解",
                    f"理论知识与实际问题的转化",
                    f"综合运用多个知识点解题",
                ],
                "activities": activities,
                "homework": (
                    f"1. 复习教材{chapter}对应章节，整理知识框架图\n"
                    f"2. 完成课后习题第{hour_idx}组（基础题+提高题）\n"
                    f"3. 预习下一课时内容，标记不理解的部分\n"
                    f"4. 思考题：{chapter}在所学专业中还有哪些应用场景？"
                ),
            })

        return {
            "id": plan_id,
            "course_name": course,
            "chapter": chapter,
            "total_hours": hours,
            "objectives": [
                {"dimension": "知识", "content": f"掌握{chapter}的核心概念、基本原理和方法体系，理解其在{course}学科中的定位"},
                {"dimension": "能力", "content": f"能够运用{chapter}的知识分析和解决实际问题，具备知识迁移和综合应用能力"},
                {"dimension": "素养", "content": f"培养科学思维和自主学习能力，建立{course}学科的系统性认知框架"},
            ],
            "methods": ["讲授法", "讨论法", "案例教学法", "练习法", "互动式教学"],
            "resources": ["教材", "多媒体课件", "板书", "在线学习平台", "教学案例库"],
            "sessions": sessions,
            "board_design": {
                "structure": "左侧：核心概念体系框架图 · 中间：关键公式/定理推导 · 右侧：典型例题演示",
                "layout": "三段式布局，按教学进程分区板书，重要内容用彩色粉笔标注",
            },
            "class_tasks": [
                {"level": "基础", "content": f"{chapter}基本概念辨析与公式应用练习"},
                {"level": "提高", "content": f"{chapter}综合变式题，要求写出完整解题步骤"},
            ],
            "homework": [
                {"level": "基础巩固", "content": f"教材{chapter}章节课后习题", "answer_hint": "参考课堂例题的解题思路"},
                {"level": "能力提升", "content": f"完成{course}学习平台上{chapter}单元在线测试", "answer_hint": ""},
                {"level": "拓展思考", "content": f"调研{chapter}在行业中的实际应用案例", "answer_hint": "查阅教材推荐阅读文献"},
            ],
            "assessment": {
                "formative": "课堂提问 + 随堂练习 + 小组讨论表现",
                "summative": f"第{hours}课时结束后进行{chapter}单元测验",
                "criteria": "概念理解（40%）+ 应用能力（40%）+ 创新思维（20%）",
            },
            "innovation": {
                "teaching_innovation": "采用案例驱动+问题导向的混合式教学，将理论知识与行业实践紧密结合",
                "technology_integration": "利用在线学习平台进行课前预习检测和课后巩固练习",
            },
            "learner_analysis": {
                "common_misconceptions": [
                    f"将{chapter}的概念与其他章节的相似概念混淆",
                    f"死记硬背公式而忽视推导逻辑和应用条件",
                    f"缺乏将理论知识转化为实际操作的能力",
                ],
                "difficult_areas": [
                    f"{chapter}中抽象概念的理解和内化",
                    f"多知识点综合应用题的解题思路构建",
                    f"理论公式与工程实践的联系",
                ],
                "weak_abilities": [
                    "复杂问题的分解与建模能力",
                    "知识点之间的关联迁移能力",
                    "自主查阅文献和拓展学习的能力",
                ],
            },
            "is_fallback": True,
            "plan_saved_to_ledger": True,
        }


class MaterialsExamAgent(Agent):
    """资料出题 Agent — 调用资料与题库完整流水线，根据教案内容生成题目。

    与 POST /api/materials/generate-questions 使用完全相同的逻辑：
    1. 从上一步备课Agent的输出中提取教案文本内容
    2. 保存为教学资料到 _materials_index（资料与题库页面可查看）
    3. 调用资料与题库的 AI 出题逻辑（同一套系统提示词 + 同一套 LLM 参数）
    4. 将生成的题目保存到 _questions_index（资料与题库页面可查看）
    5. 按题型、难度排序后返回 material_id + batch_id（前端可据此跳转）
    """

    # 与 materials.py QUESTION_SYSTEM_PROMPT 完全一致
    QUESTION_SYSTEM_PROMPT = """【当前任务：学科专业试题智能出题与分层命题】
你是一流学科建设专家型教师，根据教材内容生成标准化本科试题。

出题要求：
1. 分层出题：基础题、提高题、综合应用题、前沿创新题
2. 题型包含：选择、判断、简答、计算、案例分析、论述（按需适配）
3. 每题包含：题目、标准答案、分步评分细则、详细解析、易错点分析
4. 每题绑定知识点标签、教学目标、命题依据（教材来源/页码）
5. 试题规避网络原题，具备本科专业高阶考察性
6. 难度分布合理，覆盖不同认知层次（记忆/理解/应用/分析/评价/创造）

【数学符号强制规范】所有数学表达式必须使用标准符号：
❌ "x的n次方求和" → ✅ Σₙ₌₀ᐁ xⁿ
❌ "a_n乘以x的n次方" → ✅ aₙxⁿ 或 ∑ aₙxⁿ
❌ "f对x求导" → ✅ df/dx 或 f'(x)
❌ "从a到b的积分" → ✅ ∫ₐᵇ
用Unicode数学符号：∑ ∫ ∂ √ ² ³ ⁿ ∞ → ∈ ⊂ α β γ Δ π ≤ ≥ ≠ ≈ ± × · ₁ ₂ ₙ ½ ⅓ ⅔ ¼ ¾
分数用对角线形式：a/b、(x+1)/(x−1)，严禁用中文如"a分之b""二分之一"。
复杂分式必须加括号：(x²+1)/(x−1) ≠ x²+1/x−1

末尾添加 AI 生成标识。

输出 JSON 格式：
{
  "questions": [
    {
      "question": "题目内容",
      "type": "选择题|填空题|简答题|计算题|论述题|案例分析",
      "options": ["A. xxx", "B. xxx", "C. xxx", "D. xxx"],
      "answer": "标准答案",
      "difficulty": "基础|提高|综合|前沿创新",
      "knowledge_point": "知识点名称",
      "teaching_objective": "对应教学目标",
      "source": "命题依据（教材章节/页码/文献）",
      "scoring_rubric": "分步评分细则",
      "common_mistakes": "学生常见易错点",
      "explanation": "详细解析及解题思路",
      "cognitive_level": "记忆|理解|应用|分析|评价|创造",
      "estimated_time": 5
    }
  ]
}"""

    # 排序权重（与 materials.py 完全一致）
    _type_order = {"选择题": 1, "填空题": 2, "简答题": 3, "计算题": 4, "论述题": 5, "案例分析": 6}
    _diff_order = {"基础": 1, "提高": 2, "中等": 3, "综合": 4, "前沿创新": 5, "前沿": 5}

    def execute(self, input_data: dict[str, Any]) -> AgentResult:
        # 确保背景线程中 LLM 配置可用
        _ensure_llm_config(input_data)

        course = input_data.get("course_name", "")
        chapter = input_data.get("chapter", "")
        question_count = input_data.get("question_count", 8)
        question_difficulty = input_data.get("question_difficulty", "中等")
        question_types = input_data.get("question_types", ["选择题", "判断题", "填空题", "简答题"])
        if isinstance(question_types, str):
            question_types = [t.strip() for t in question_types.split(",") if t.strip()]
        # 从上一步（备课Agent）的输出中提取教案数据
        lesson_data = input_data.get("step_备课") or input_data.get("_备课", {})

        # 将教案内容提取为文本
        text_content = self._plan_to_text(course, chapter, lesson_data)

        material_id = ""
        try:
            from app.api.materials import _materials_index, _questions_index, _save_indexes
            import uuid as _uuid

            # 1. 保存教学资料到 _materials_index（与上传流程一致，在资料与题库页面可见）
            material_id = f"wf_{_uuid.uuid4().hex[:8]}"
            content_bytes = len(text_content.encode("utf-8"))
            _materials_index[material_id] = {
                "id": material_id,
                "filename": f"教案_{course}_{chapter}.txt",
                "course": course,
                "chapter": chapter,
                "size": content_bytes,
                "size_display": f"{content_bytes / 1024:.1f} KB" if content_bytes < 1024 * 1024 else f"{content_bytes / 1024 / 1024:.1f} MB",
                "pages": max(1, content_bytes // 3000),
                "text_content": text_content,
                "text_preview": text_content[:5000],
                "_source": "agent",
                "created_at": datetime.now().isoformat()[:19],
            }
            _save_indexes()
            logger.info(f"[资料出题Agent] 教学资料已保存: material_id={material_id}")

            # 2. 调用资料与题库的 AI 出题逻辑（与 POST /api/materials/generate-questions 完全一致）
            count = min(question_count, 20)
            context = text_content[:8000]

            types_text = "、".join(question_types) if question_types else "选择题、判断题、填空题、简答题"
            user_prompt = f"""请根据以下教材内容，生成 {count} 道{question_difficulty}难度的练习题。

教材内容（{course} - {chapter or '综合'}）：
{context}

题目类型：{types_text}
难度级别：{question_difficulty}
题目数量：{count} 题

请确保覆盖不同知识点，难度分布合理。"""

            result = chat_json(
                messages=[
                    {"role": "system", "content": self.QUESTION_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.5,
                max_tokens=8192,
            )
            questions = result.get("questions", [])
            if not questions and "exercises" in result:
                questions = result["exercises"]

            # 过滤掉空题目（LLM 可能返回占位空项）
            questions = [q for q in questions if isinstance(q, dict) and q.get("question", "").strip()]

            # 3. 保存题目到 _questions_index（与 API 端点格式一致）
            batch_id = str(_uuid.uuid4())[:8]
            saved_questions = []
            for i, q in enumerate(questions):
                qid = f"{batch_id}_{i}"  # 与 materials.py 一致的 ID 格式
                question_item = {
                    "id": qid,
                    "batch_id": batch_id,
                    "material_id": material_id,
                    "material_name": f"教案_{course}_{chapter}",
                    "course": course,
                    "chapter": chapter,
                    "question": q.get("question", ""),
                    "type": q.get("type", "简答题"),
                    "options": q.get("options", []),
                    "answer": q.get("answer", ""),
                    "difficulty": q.get("difficulty", "中等"),
                    "knowledge_point": q.get("knowledge_point", ""),
                    "explanation": q.get("explanation", ""),
                    "estimated_time": q.get("estimated_time", 5),
                    "status": "draft",
                    "_source": "agent",
                    "created_at": datetime.now().isoformat()[:19],
                }
                _questions_index[qid] = question_item
                saved_questions.append(question_item)

            # 按题型、难度排序（与 materials.py 完全一致）
            saved_questions.sort(key=lambda q: (
                self._type_order.get(q.get("type", ""), 99),
                self._diff_order.get(q.get("difficulty", ""), 99),
            ))

            _save_indexes()
            logger.info(f"[资料出题Agent] LLM返回{len(questions)}题, 已保存{len(saved_questions)}题到资料与题库: batch_id={batch_id}, material_id={material_id}")

            summary = f"基于教案通过资料与题库生成 {len(saved_questions)} 道配套习题"
            return self._ok({
                "exam_title": f"{course} — {chapter or '综合'} 配套练习",
                "material_id": material_id,
                "batch_id": batch_id,
                "questions_saved_to_bank": True,
                "question_count": len(saved_questions),
                "total_score": 100,
                "sections": [{"type": "配套习题", "questions": [
                    {"number": i + 1, "question": q.get("question", ""),
                     "type": q.get("type", "简答题"), "options": q.get("options", []),
                     "answer": q.get("answer", ""), "score": 10,
                     "knowledge_point": q.get("knowledge_point", ""),
                     "difficulty": q.get("difficulty", "中等"),
                     "explanation": q.get("explanation", ""),
                     "estimated_time": q.get("estimated_time", 5)}
                    for i, q in enumerate(saved_questions)
                ]}],
                "raw_questions": saved_questions,
            }, summary, input_summary=f"资料出题: {course} {chapter}")
        except Exception as e:
            logger.warning(f"MaterialsExamAgent 出题失败: {e}")
            fallback = {
                "exam_title": f"{course} — {chapter} 配套练习（降级模板）",
                "material_id": material_id or "",
                "sections": [{"type": "配套习题", "questions": [
                    {"number": i + 1, "question": f"请简述教案中第{i+1}个知识点的核心概念",
                     "type": "简答题", "score": 10, "knowledge_point": f"{chapter}-知识点{i+1}"}
                    for i in range(min(question_count, 8))
                ]}],
                "_fallback": True,
            }
            return self._ok(fallback, f"（降级模板）已生成 {min(question_count, 8)} 道习题",
                            input_summary=f"课程={course} 章节={chapter}")

    def _plan_to_text(self, course: str, chapter: str, lesson_data: dict) -> str:
        """将教案 JSON 转为丰富的文本内容，供资料与题库 AI 出题使用。

        提取教案中的：教学目标、重点难点、教学流程（含教师讲解脚本+教学示例）、
        课后作业、教学方法等，构建完整的出题上下文。
        """
        lines = [f"# 课程：{course}", f"# 章节：{chapter}", ""]

        # 教学目标
        objectives = lesson_data.get("objectives", [])
        if objectives:
            lines.append("## 教学目标")
            for obj in objectives:
                if isinstance(obj, dict):
                    lines.append(f"- [{obj.get('dimension', '')}] {obj.get('content', '')}")
                else:
                    lines.append(f"- {obj}")
            lines.append("")

        # 教学方法
        methods = lesson_data.get("methods", [])
        if methods:
            lines.append(f"## 教学方法：{', '.join(methods)}")
            lines.append("")

        # 教学流程（核心内容，从每个活动中提取详细信息）
        sessions = lesson_data.get("sessions", [])
        if sessions:
            lines.append("## 教学流程")
        for s in sessions:
            topic = s.get("session_topic", "")
            lines.append(f"### {topic}")

            # 重点
            for kp in s.get("key_points", []):
                lines.append(f"【教学重点】{kp}")

            # 难点
            for dp in s.get("difficult_points", []):
                lines.append(f"【教学难点】{dp}")

            # 活动详情
            for act in s.get("activities", []):
                if isinstance(act, dict):
                    atype = act.get("activity_type", "")
                    content = act.get("content", "")
                    teacher = act.get("teacher_activity", "")
                    student = act.get("student_activity", "")
                    example = act.get("example", "")

                    if atype or content:
                        lines.append(f"\n[{atype}] {content}")
                    if teacher:
                        lines.append(f"  教师讲解：{teacher[:300]}")
                    if student:
                        lines.append(f"  学生活动：{student[:200]}")
                    if example:
                        lines.append(f"  教学示例：{example[:300]}")
                else:
                    lines.append(f"- {act}")

            # 课后作业
            hw = s.get("homework", "")
            if hw:
                lines.append(f"\n课后作业：{hw[:300]}")
            lines.append("")

        # 全局课后作业（多层）
        homework_list = lesson_data.get("homework", [])
        if homework_list and isinstance(homework_list, list):
            lines.append("## 分层课后作业")
            for hw in homework_list:
                if isinstance(hw, dict):
                    lines.append(f"- [{hw.get('level', '')}] {hw.get('content', '')}（提示：{hw.get('answer_hint', '')}）")
            lines.append("")

        # 课堂任务
        class_tasks = lesson_data.get("class_tasks", [])
        if class_tasks:
            lines.append("## 课堂任务")
            for ct in class_tasks:
                if isinstance(ct, dict):
                    lines.append(f"- [{ct.get('level', '')}] {ct.get('content', '')}")
            lines.append("")

        text = "\n".join(lines)
        # 如果教案内容太少（降级方案），补充课程基本信息
        if len(text) < 500:
            text = (
                f"课程名称：{course}\n"
                f"章节：{chapter}\n\n"
                f"本章节涵盖{chapter}的核心概念、基本原理和应用方法。\n"
                f"包括但不限于：概念定义、推导过程、算法流程、实际应用案例分析。\n"
                f"重点：{chapter}的基本原理与核心算法。\n"
                f"难点：{chapter}的综合应用与实际问题建模。"
            )
        return text


class EnrichmentAgent(Agent):
    """拔高 Agent — 为高分学生生成进阶挑战题。"""

    def execute(self, input_data: dict[str, Any]) -> AgentResult:
        _ensure_llm_config(input_data)
        course = input_data.get("course_name", "")
        chapter = input_data.get("chapter", "")

        try:
            result = chat_json(
                messages=[
                    {"role": "system", "content": """你是学科拔高专家，为学有余力的学生生成创新挑战题。
输出 JSON：{"questions":[{"question":"...","type":"综合创新","difficulty":"挑战","answer":"...","explanation":"...","knowledge_point":"..."}]}"""},
                    {"role": "user", "content": f"为「{course}」{chapter} 生成 3 道拔高创新题"},
                ],
                temperature=0.5,
            )
            return self._ok(result, f"已生成拔高题目")
        except Exception:
            return self._ok({"questions": [{"question": f"请设计一个实验验证 {chapter} 的核心理论", "type": "综合创新", "difficulty": "挑战"}]},
                            "（降级）已生成拔高题目")


class RemedialAgent(Agent):
    """补差 Agent — 为低分学生生成基础巩固题。"""

    def execute(self, input_data: dict[str, Any]) -> AgentResult:
        _ensure_llm_config(input_data)
        course = input_data.get("course_name", "")
        chapter = input_data.get("chapter", "")
        weak_points = input_data.get("weak_points", [])

        kps = ", ".join(weak_points) if weak_points else "基础知识"
        try:
            result = chat_json(
                messages=[
                    {"role": "system", "content": """你是基础巩固专家，为基础薄弱学生生成循序渐进的练习题。
输出 JSON：{"exercises":[{"question":"...","type":"基础","difficulty":"简单","answer":"...","hint":"...","knowledge_point":"..."}]}"""},
                    {"role": "user", "content": f"为「{course}」{chapter} 薄弱点 [{kps}] 生成 5 道基础巩固题"},
                ],
                temperature=0.3,
            )
            return self._ok(result, f"已生成基础巩固题")
        except Exception:
            return self._ok({"exercises": [{"question": f"请简述 {kp} 的基本概念", "type": "基础", "difficulty": "简单", "hint": "可参考教材相关章节"} for kp in weak_points[:5] or ["基础知识"]]},
                            "（降级）已生成基础巩固题")


# ═══════════════════════════════════════════════════════════════
# 工作流编排
# ═══════════════════════════════════════════════════════════════


class Workflow:
    """工作流编排器基类。"""

    def __init__(self, name: str, workflow_type: str, description: str = ""):
        self.id = uuid.uuid4().hex[:16]
        self.name = name
        self.type = workflow_type
        self.description = description
        self.status = WorkflowStatus.PENDING
        self.steps: list[AgentResult] = []
        self._progress_queue: Queue = Queue()
        self._created_at = datetime.now()
        self._completed_at: datetime | None = None
        self._on_progress: Callable[[WorkflowProgress], None] | None = None

    def set_progress_callback(self, cb: Callable[[WorkflowProgress], None]):
        self._on_progress = cb

    def _emit(self, step_index: int, step_name: str, status: str, summary: str = "", preview: str = ""):
        p = WorkflowProgress(step_index=step_index, step_name=step_name, status=status, summary=summary, output_preview=preview)
        self._progress_queue.put(p)
        if self._on_progress:
            try:
                self._on_progress(p)
            except Exception:
                pass

    def get_progress_queue(self) -> Queue:
        return self._progress_queue

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "description": self.description,
            "status": self.status.value,
            "steps": [
                {"agent_name": s.agent_name, "status": s.status.value, "input_summary": s.input_summary,
                 "output_text": s.output_text[:200], "error": s.error, "duration_ms": s.duration_ms}
                for s in self.steps
            ],
            "final_output": self.get_final_output(),
            "created_at": self._created_at.isoformat(),
            "completed_at": self._completed_at.isoformat() if self._completed_at else None,
        }

    def get_final_output(self) -> dict:
        """子类覆盖以返回结构化最终输出。"""
        return {"steps": [s.output for s in self.steps]}


class SequentialWorkflow(Workflow):
    """链式编排：步骤按顺序执行，前一步输出作为后一步输入。"""

    def __init__(self, name: str, workflow_type: str, agents: list[tuple[str, Agent]], description: str = ""):
        super().__init__(name, workflow_type, description)
        self._agent_chain = agents  # [(step_name, agent), ...]

    def run(self, initial_input: dict[str, Any]) -> dict:
        self.status = WorkflowStatus.RUNNING
        self.steps = []
        data = dict(initial_input)

        for i, (step_name, agent) in enumerate(self._agent_chain):
            self._emit(i, step_name, "running", f"正在执行：{step_name}")
            started = datetime.now()

            try:
                result = agent.execute(data)
                elapsed = int((datetime.now() - started).total_seconds() * 1000)
                result.agent_name = step_name
                result.duration_ms = elapsed
                self.steps.append(result)

                if result.status == StepStatus.COMPLETED:
                    # 将本步输出合并到 data 供下一步使用
                    data[f"step_{step_name}"] = result.output
                    data.update({f"_{step_name}": result.output})  # 兼容旧键
                    preview = result.output_text[:200] if result.output_text else json.dumps(result.output, ensure_ascii=False)[:200]
                    self._emit(i, step_name, "completed", f"{step_name} 完成（{elapsed}ms）", preview)
                else:
                    self._emit(i, step_name, "failed", f"{step_name} 失败: {result.error}")
                    self.status = WorkflowStatus.FAILED
                    self._completed_at = datetime.now()
                    return self.to_dict()

            except Exception as e:
                error_msg = str(e)[:200]
                fail_result = AgentResult(agent_name=step_name, status=StepStatus.FAILED, error=error_msg)
                self.steps.append(fail_result)
                self._emit(i, step_name, "failed", f"异常: {error_msg}")
                self.status = WorkflowStatus.FAILED
                self._completed_at = datetime.now()
                return self.to_dict()

        self.status = WorkflowStatus.COMPLETED
        self._completed_at = datetime.now()
        return self.to_dict()

    def get_final_output(self) -> dict:
        out: dict = {"workflow_type": self.type}
        for i, (step_name, _agent) in enumerate(self._agent_chain):
            if i < len(self.steps):
                out[step_name] = self.steps[i].output
        return out


class BranchWorkflow(Workflow):
    """分支编排：根据条件判断执行不同分支。"""

    def __init__(self, name: str, workflow_type: str,
                 condition_agent: tuple[str, Agent],
                 condition_fn: Callable[[dict], str],
                 branches: dict[str, list[tuple[str, Agent]]],
                 description: str = ""):
        super().__init__(name, workflow_type, description)
        self._condition_agent = condition_agent
        self._condition_fn = condition_fn
        self._branches = branches

    def run(self, initial_input: dict[str, Any]) -> dict:
        self.status = WorkflowStatus.RUNNING
        self.steps = []
        data = dict(initial_input)

        # Step 0: 条件判断 Agent
        cond_name, cond_agent = self._condition_agent
        self._emit(0, cond_name, "running", f"正在执行：{cond_name}")
        started = datetime.now()
        try:
            result = cond_agent.execute(data)
            elapsed = int((datetime.now() - started).total_seconds() * 1000)
            result.agent_name = cond_name
            result.duration_ms = elapsed
            self.steps.append(result)
            data[f"step_{cond_name}"] = result.output
            self._emit(0, cond_name, "completed", f"{cond_name} 完成（{elapsed}ms）")
        except Exception as e:
            self.steps.append(AgentResult(agent_name=cond_name, status=StepStatus.FAILED, error=str(e)[:200]))
            self.status = WorkflowStatus.FAILED
            self._completed_at = datetime.now()
            return self.to_dict()

        # 分支选择
        branch_key = self._condition_fn(result.output)
        branch_agents = self._branches.get(branch_key, [])
        self._emit(-1, "branch", "completed", f"条件分支 → {branch_key}")

        # 执行分支
        for j, (step_name, agent) in enumerate(branch_agents):
            idx = 1 + j
            self._emit(idx, step_name, "running", f"正在执行：{step_name} [{branch_key}]")
            started = datetime.now()
            try:
                r = agent.execute(data)
                elapsed = int((datetime.now() - started).total_seconds() * 1000)
                r.agent_name = step_name
                r.duration_ms = elapsed
                self.steps.append(r)
                self._emit(idx, step_name, "completed", f"{step_name} 完成（{elapsed}ms）")
            except Exception as e:
                self.steps.append(AgentResult(agent_name=step_name, status=StepStatus.FAILED, error=str(e)[:200]))
                self.status = WorkflowStatus.FAILED
                self._completed_at = datetime.now()
                return self.to_dict()

        self.status = WorkflowStatus.COMPLETED
        self._completed_at = datetime.now()
        return self.to_dict()

    def get_final_output(self) -> dict:
        return {"workflow_type": self.type, "branch_taken": "",
                "steps": [s.output for s in self.steps]}


# ═══════════════════════════════════════════════════════════════
# 预置工作流工厂
# ═══════════════════════════════════════════════════════════════

WORKFLOW_REGISTRY: dict[str, dict] = {}


def _register(wf_type: str, name: str, description: str, params: list[dict]):
    WORKFLOW_REGISTRY[wf_type] = {"type": wf_type, "name": name, "description": description, "params": params}


_register("class_diagnosis", "班级诊断全流程",
          "批改 → 学情分析 → 补差方案，一键生成完整班级诊断报告",
          [
              {"name": "course_name", "label": "课程名称", "type": "text", "required": True, "placeholder": "如：机器学习"},
              {"name": "chapter", "label": "章节", "type": "text", "required": False, "placeholder": "如：线性回归"},
          ])

_register("lesson_to_exam", "智能备课→出题一站式",
          "生成教案 → 配套练习题 → 课后作业，一站式备课方案。教案保存至教学台账中心，题目保存至资料与题库。",
          [
              {"name": "course_name", "label": "课程名称", "type": "text", "required": True, "placeholder": "如：深度学习"},
              {"name": "chapter", "label": "章节", "type": "text", "required": True, "placeholder": "如：卷积神经网络"},
              {"name": "teaching_hours", "label": "课时数", "type": "number", "required": False, "default": 2},
              {"name": "question_count", "label": "出题数量", "type": "number", "required": False, "default": 8},
              {"name": "question_difficulty", "label": "出题难度", "type": "select", "required": False, "default": "中等",
               "options": ["基础", "中等", "提高", "综合", "前沿"]},
              {"name": "question_types", "label": "题目类型", "type": "multiselect", "required": False,
               "default": ["选择题", "判断题", "填空题", "简答题"],
               "options": ["选择题", "判断题", "填空题", "简答题", "论述题", "计算题"]},
              {"name": "additional_requirements", "label": "附加要求", "type": "text", "required": False, "placeholder": "偏重实践/增加互动/案例驱动"},
              {"name": "textbook_content", "label": "教材内容（RAG 增强备课质量）", "type": "textarea", "required": False, "placeholder": "粘贴教材内容、讲义要点... 留空则 AI 基于学科常识生成"},
          ])

def create_workflow(workflow_type: str, input_params: dict) -> Workflow:
    """根据类型创建预置工作流实例。"""
    course = input_params.get("course_name", "")
    chapter = input_params.get("chapter", "")
    kps_text = input_params.get("knowledge_points", "")
    knowledge_points = [k.strip() for k in kps_text.split(",") if k.strip()] if kps_text else []
    question_count = int(input_params.get("question_count", 10))
    teaching_hours = int(input_params.get("teaching_hours", 2))

    # ── 透传 LLM 配置到背景线程 ──
    _llm_config = {
        "_llm_api_key": input_params.get("_llm_api_key", ""),
        "_llm_base_url": input_params.get("_llm_base_url", ""),
        "_llm_model_name": input_params.get("_llm_model_name", ""),
    }

    if workflow_type == "class_diagnosis":
        wf = SequentialWorkflow(
            name="班级诊断全流程", workflow_type=workflow_type,
            agents=[
                ("批改", GradingAgent("批改Agent", "批改学生答案")),
                ("分析", AnalysisAgent("分析Agent", "学情数据诊断")),
                ("建议", PlanAgent("建议Agent", "生成补差方案")),
            ],
            description=f"对「{course}」{chapter} 进行全流程诊断",
        )
        initial = {"course_name": course, "chapter": chapter, **_llm_config}
        return wf, initial

    elif workflow_type == "lesson_to_exam":
        wf = SequentialWorkflow(
            name="智能备课→出题一站式", workflow_type=workflow_type,
            agents=[
                ("备课", LessonAgent("备课Agent", "生成教案并保存至教学台账中心")),
                ("资料出题", MaterialsExamAgent("资料出题Agent", "根据教案内容出题并保存至资料与题库")),
                ("作业建议", PlanAgent("作业建议Agent", "生成课后分层作业")),
            ],
            description=f"为「{course}」{chapter} 一站式备课+出题",
        )
        question_count_l2e = int(input_params.get("question_count", 8))
        question_difficulty = input_params.get("question_difficulty", "中等")
        question_types = input_params.get("question_types", ["选择题", "判断题", "填空题", "简答题"])
        if isinstance(question_types, str):
            question_types = [t.strip() for t in question_types.split(",") if t.strip()]
        additional_req = input_params.get("additional_requirements", "") or f"根据教材内容为 {course} {chapter} 备课"
        textbook = input_params.get("textbook_content", "")
        initial = {"course_name": course, "chapter": chapter, "teaching_hours": teaching_hours,
                   "question_count": question_count_l2e, "knowledge_points": knowledge_points,
                   "question_difficulty": question_difficulty, "question_types": question_types,
                   "additional_requirements": additional_req,
                   "textbook_content": textbook,
                   **_llm_config}
        return wf, initial

    else:
        raise ValueError(f"未知工作流类型: {workflow_type}")


def run_workflow_async(workflow: Workflow, initial_input: dict,
                       on_complete: Callable[[dict], None],
                       on_progress: Callable[[WorkflowProgress], None] | None = None):
    """在后台线程中异步执行工作流。"""
    if on_progress:
        workflow.set_progress_callback(on_progress)

    def _run():
        result = workflow.run(initial_input)
        on_complete(result)

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return t


# ═══════════════════════════════════════════════════════════════
# 工作流存储（内存 + 数据库双写）
# ═══════════════════════════════════════════════════════════════

_active_workflows: dict[str, Workflow] = {}
_completed_workflows: dict[str, dict] = {}


def store_workflow(wf: Workflow):
    _active_workflows[wf.id] = wf
    # 持久化到数据库
    try:
        from app.models.database import SessionLocal, AgentWorkflow
        db = SessionLocal()
        existing = db.query(AgentWorkflow).filter(AgentWorkflow.id == wf.id).first()
        wf_dict = wf.to_dict()

        # 从 final_output 中提取课程名称和章节，供历史列表展示
        final_output = wf_dict.get("final_output", {})
        course_name = ""
        chapter = ""
        # lesson_to_exam: 备课 → course_name/chapter
        for step_key in ("备课", "批改", "资料出题", "作业建议"):
            step_data = final_output.get(step_key, {})
            if step_data.get("course_name"):
                course_name = step_data["course_name"]
                chapter = step_data.get("chapter", "")
                break
        # class_diagnosis / branch_grading 可能没有 course_name，从 description 推断
        if not course_name and wf.description:
            import re
            m = re.search(r'「(.+?)」(.+)', wf.description)
            if m:
                course_name = m.group(1)
                chapter = m.group(2)

        input_params = json.dumps({
            "name": wf.name,
            "description": wf.description,
            "course_name": course_name,
            "chapter": chapter,
        }, ensure_ascii=False)

        if existing:
            existing.status = wf_dict["status"]
            existing.steps = json.dumps(wf_dict["steps"], ensure_ascii=False)
            existing.final_output = json.dumps(wf_dict["final_output"], ensure_ascii=False)
            existing.input_params = input_params
            if wf_dict["completed_at"]:
                existing.completed_at = datetime.fromisoformat(wf_dict["completed_at"])
        else:
            record = AgentWorkflow(
                id=wf.id, type=wf.type, status=wf_dict["status"],
                input_params=input_params,
                steps=json.dumps(wf_dict["steps"], ensure_ascii=False),
                final_output=json.dumps(wf_dict["final_output"], ensure_ascii=False),
                created_at=datetime.now(),
            )
            db.add(record)
        db.commit()
        db.close()
    except Exception as e:
        logger.warning(f"工作流持久化失败: {e}")


def get_workflow_result(workflow_id: str) -> dict | None:
    """获取工作流结果。"""
    wf = _active_workflows.get(workflow_id)
    if wf:
        return wf.to_dict()
    # 从数据库回退
    try:
        from app.models.database import SessionLocal, AgentWorkflow
        db = SessionLocal()
        record = db.query(AgentWorkflow).filter(AgentWorkflow.id == workflow_id).first()
        db.close()
        if record:
            params = json.loads(record.input_params or "{}")
            return {
                "id": record.id, "name": params.get("name", ""),
                "course_name": params.get("course_name", ""),
                "chapter": params.get("chapter", ""),
                "type": record.type, "status": record.status,
                "steps": json.loads(record.steps or "[]"),
                "final_output": json.loads(record.final_output or "{}"),
                "created_at": record.created_at.isoformat() if record.created_at else "",
                "completed_at": record.completed_at.isoformat() if record.completed_at else None,
            }
    except Exception:
        pass
    return None


def get_workflow_history(limit: int = 50) -> list[dict]:
    """获取历史工作流列表（含课程名称和章节）。"""
    try:
        from app.models.database import SessionLocal, AgentWorkflow
        db = SessionLocal()
        records = db.query(AgentWorkflow).order_by(AgentWorkflow.created_at.desc()).limit(limit).all()
        db.close()
        result = []
        for r in records:
            params = json.loads(r.input_params or "{}")
            result.append({
                "id": r.id, "type": r.type, "status": r.status,
                "name": params.get("name", ""),
                "course_name": params.get("course_name", ""),
                "chapter": params.get("chapter", ""),
                "created_at": r.created_at.isoformat() if r.created_at else "",
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            })
        return result
    except Exception:
        return []


def delete_workflow(workflow_id: str) -> dict | None:
    """删除工作流记录，并清理教学台账中心和资料与题库中的关联内容。

    返回 cleanup_info 字典（含清理统计），供 API 层拼装提示信息。
    """
    cleanup_info = {"plan_deleted": False, "questions_deleted": 0, "material_deleted": False}

    # ── 先获取工作流数据，提取关联的资源 ID ──
    wf_data = get_workflow_result(workflow_id)
    plan_id = ""
    material_id = ""
    if wf_data:
        final_output = wf_data.get("final_output", {})
        plan_id = final_output.get("备课", {}).get("plan_id", "")
        material_id = final_output.get("资料出题", {}).get("material_id", "")

    # ── 清理教学台账中心：删除关联的教案 ──
    if plan_id:
        try:
            from app.models.database import SessionLocal, LessonPlan
            db = SessionLocal()
            lp = db.query(LessonPlan).filter(LessonPlan.id == plan_id).first()
            if lp:
                # 同时清理审计日志和版本快照
                try:
                    from app.models.database import AuditLog, PlanSnapshot
                    db.query(AuditLog).filter(AuditLog.plan_id == plan_id).delete()
                    db.query(PlanSnapshot).filter(PlanSnapshot.plan_id == plan_id).delete()
                except Exception:
                    pass
                db.delete(lp)
                db.commit()
                cleanup_info["plan_deleted"] = True
                logger.info(f"[delete_workflow] 已删除教学台账教案: plan_id={plan_id}")
            db.close()
        except Exception as e:
            logger.warning(f"[delete_workflow] 删除教案失败: plan_id={plan_id}, error={e}")

    # ── 清理资料与题库：删除关联的资料和题目 ──
    if material_id:
        try:
            from app.api.materials import _materials_index, _questions_index, _save_indexes, MATERIALS_DIR

            # 删除关联的题目
            removed_qids = [qid for qid, q in list(_questions_index.items())
                           if q.get("material_id") == material_id]
            for qid in removed_qids:
                _questions_index.pop(qid, None)
            cleanup_info["questions_deleted"] = len(removed_qids)

            # 删除资料索引
            if material_id in _materials_index:
                _materials_index.pop(material_id, None)
                cleanup_info["material_deleted"] = True

            # 删除资料文件
            for f in MATERIALS_DIR.iterdir():
                if f.name.startswith(material_id):
                    f.unlink(missing_ok=True)

            _save_indexes()
            logger.info(f"[delete_workflow] 已删除资料与题库: material_id={material_id}, 题目{len(removed_qids)}道")
        except Exception as e:
            logger.warning(f"[delete_workflow] 删除资料/题目失败: material_id={material_id}, error={e}")

    # ── 删除工作流记录本身 ──
    _active_workflows.pop(workflow_id, None)
    try:
        from app.models.database import SessionLocal, AgentWorkflow
        db = SessionLocal()
        record = db.query(AgentWorkflow).filter(AgentWorkflow.id == workflow_id).first()
        if record:
            db.delete(record)
            db.commit()
        db.close()
        logger.info(f"[delete_workflow] 工作流记录已删除: workflow_id={workflow_id}")
        return cleanup_info
    except Exception as e:
        logger.warning(f"[delete_workflow] 删除工作流记录失败: {e}")
        return None
