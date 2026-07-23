"""
学情洞察服务 — AI 驱动的学情分析与预警。

核心功能：
1. 学生个体学情分析（知识掌握度、趋势、预警）
2. 班级整体学情分析（分布、薄弱环节）
3. 个性化学习建议生成
"""

from __future__ import annotations

import json
from typing import Any

from app.core.llm import chat_json
from app.models.schemas import (
    ClassInsightRequest,
    ClassInsightResponse,
    KnowledgeMastery,
    PerformanceRecord,
    StudentInsightRequest,
    StudentInsightResponse,
)


INSIGHT_SYSTEM_PROMPT = """【当前任务：多维度AI学情诊断报告生成】
你是一流学科建设教学数据分析专家，基于学生成绩与作业数据，
生成完整、详细、可落地的学情诊断报告。

报告必须包含以下全部模块，输出 JSON 格式：

1. 学情整体总结：学生学习水平定位、学习习惯判断、核心问题提炼
2. 知识强弱分层清单：完全掌握/部分掌握/完全薄弱知识点（各知识点标注掌握度百分比及趋势）
3. 高频错题深度分析：列出高频错误类型及成因（概念混淆/计算失误/审题不清/思路偏差）
4. 个性化分层提升方案：
   - 课堂任务建议（含教师引导话术）
   - 课后补差习题方向
   - 一对一辅导策略
5. 能力维度分析：记忆/理解/应用/创新四个维度能力评估
6. 课程思政引导建议：针对学习短板的思维培养指导
7. 预警判断：是否存在成绩下滑/挂科风险/知识点严重薄弱

所有分析标注知识来源，末尾添加 AI 生成标识。

输出 JSON 格式：
{
  "overall_score": 78.5,
  "completion_rate": 92.0,
  "ranking": "前30%",
  "trend_description": "近期成绩呈上升趋势...",
  "summary": "学生学习水平定位与核心问题总结...",
  "knowledge_mastery": [
    {"name": "知识点名称", "mastery": 85.0, "trend": "上升", "practice_count": 12, "avg_score": 85.0, "category": "重点|基础|难点"}
  ],
  "mastery_levels": {
    "mastered": ["完全掌握知识点1", "完全掌握知识点2"],
    "partial": ["部分掌握知识点1"],
    "weak": ["完全薄弱知识点1"]
  },
  "weak_points": ["薄弱知识点1"],
  "strong_points": ["优势知识点1"],
  "error_analysis": [
    {"type": "概念混淆|计算失误|审题不清|思路偏差", "description": "具体表现", "frequency": "高|中|低", "suggestions": "改进方向"}
  ],
  "ability_gaps": {"memory": 80, "understanding": 70, "application": 55, "innovation": 40},
  "common_mistakes": [{"rank": 1, "mistake": "高频错误描述", "count": 15, "suggestions": "补救方案"}],
  "class_tiers": {"weak": {"ratio": 0.2, "profile": ""}, "medium": {"ratio": 0.5, "profile": ""}, "excellent": {"ratio": 0.3, "profile": ""}},
  "remedial_plan": [
    {"type": "课堂任务|课后补差|辅导策略", "content": "具体建议", "target": "针对的知识点"}
  ],
  "ideological_political": "课程思政引导建议",
  "teaching_adjustments": ["下节课教学优化建议1"],
  "warnings": ["预警信息"],
  "recommendations": ["具体学习建议"],
  "attention_needed": false
}"""


def _parse_records(records: list[PerformanceRecord]) -> str:
    """将成绩记录转为可读文本。"""
    if not records:
        return "（无历史成绩数据）"
    lines = []
    for r in records:
        lines.append(f"- [{r.date}] {r.exam_name or r.category}：{r.score}/{r.total_score}分")
    return "\n".join(lines)


def analyze_student(request: StudentInsightRequest) -> StudentInsightResponse:
    """
    分析单个学生的学情。

    核心定量指标（平均分、趋势、完成率）直接基于成绩记录计算，
    保证与输入数据严格一致；定性分析（建议、薄弱点等）由 LLM 生成。
    """
    records_text = _parse_records(request.records)

    # ── 基于实际数据计算核心定量指标 ──
    raw_scores = [r.score / r.total_score * 100 if r.total_score else 0 for r in request.records]
    computed_overall = round(sum(raw_scores) / len(raw_scores), 1) if raw_scores else 0.0
    computed_completion = min(100.0, len(raw_scores) / max(len(raw_scores), 1) * 100)

    # 趋势判断
    if len(raw_scores) >= 2:
        recent = sum(raw_scores[-2:]) / 2 if len(raw_scores) >= 2 else raw_scores[-1]
        earlier = sum(raw_scores[:2]) / 2 if len(raw_scores) >= 2 else raw_scores[0]
        diff = recent - earlier
        if diff > 10:
            computed_trend = f"近期成绩显著上升（近两次均分{recent:.1f}，初期均分{earlier:.1f}，提升{diff:.0f}分）"
        elif diff > 3:
            computed_trend = f"近期成绩稳步上升（近两次均分{recent:.1f}，初期均分{earlier:.1f}，提升{diff:.0f}分）"
        elif diff < -10:
            computed_trend = f"近期成绩明显下滑（近两次均分{recent:.1f}，初期均分{earlier:.1f}，下降{-diff:.0f}分），需重点关注"
        elif diff < -3:
            computed_trend = f"近期成绩略有下降（近两次均分{recent:.1f}，初期均分{earlier:.1f}，下降{-diff:.0f}分）"
        else:
            computed_trend = f"成绩整体稳定（近两次均分{recent:.1f}，波动小于3分）"
    else:
        computed_trend = "数据不足，无法判断趋势"

    # ── LLM 生成定性分析（建议、薄弱点等） ──
    user_prompt = f"""请对学生进行多维度AI学情诊断分析：

学生ID：{request.student_id}
学生姓名：{request.student_name or '未知'}
课程名称：{request.course_name}

成绩记录：
{records_text}

已计算核心指标（请勿修改）：综合评分={computed_overall}分，完成率={computed_completion}%，趋势={computed_trend}

请重点分析：知识强弱分层、高频错误类型、个性化提升方案、能力维度评估、课程思政建议、预警判断。"""

    ai_generated = True
    try:
        result = chat_json(
            messages=[
                {"role": "system", "content": INSIGHT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
        )
    except Exception as e:
        ai_generated = False
        result = {
            "overall_score": computed_overall,
            "completion_rate": computed_completion,
            "ranking": "",
            "trend_description": computed_trend,
            "summary": f"基于{len(raw_scores)}次考试数据：平均分{computed_overall}分，{computed_trend}（AI 服务暂不可用，以下为数据统计结果）",
            "knowledge_mastery": [],
            "mastery_levels": {"mastered": [], "partial": [], "weak": []},
            "weak_points": [],
            "strong_points": [],
            "error_analysis": [],
            "ability_gaps": {"memory": 75, "understanding": 70, "application": 60, "innovation": 50},
            "common_mistakes": [],
            "class_tiers": {},
            "remedial_plan": [],
            "ideological_political": "",
            "warnings": [],
            "recommendations": [],
            "attention_needed": computed_overall < 60,
        }

    # 使用计算值覆盖 LLM 返回值，确保数值准确性
    result["overall_score"] = computed_overall
    result["completion_rate"] = computed_completion
    result["trend_description"] = computed_trend
    if not result.get("summary"):
        result["summary"] = f"基于{len(raw_scores)}次考试数据：平均分{computed_overall}分，{computed_trend}"
    result["attention_needed"] = computed_overall < 60

    # 解析知识掌握度
    mastery_data = result.get("knowledge_mastery", [])
    mastery_list = []
    for m in mastery_data:
        try:
            mastery_list.append(KnowledgeMastery(
                name=m.get("name", ""),
                mastery=min(100, max(0, float(m.get("mastery", 0)))),
                trend=m.get("trend", "稳定"),
                practice_count=int(m.get("practice_count", 0)),
                avg_score=float(m.get("avg_score", 0)),
                category=m.get("category", ""),
            ))
        except (ValueError, TypeError):
            continue

    # 构建雷达图数据
    radar_data = [
        {"name": km.name, "value": km.mastery}
        for km in mastery_list
    ]

    # 构建趋势图数据
    trend_data = [
        {"date": r.date, "value": r.score / r.total_score * 100 if r.total_score else 0, "category": r.category}
        for r in request.records
    ]

    return StudentInsightResponse(
        student_id=request.student_id,
        course_name=request.course_name,
        overall_score=float(result.get("overall_score", 0)),
        completion_rate=float(result.get("completion_rate", 0)),
        ranking=result.get("ranking", ""),
        trend_description=result.get("trend_description", ""),
        knowledge_mastery=mastery_list,
        weak_points=result.get("weak_points", []),
        strong_points=result.get("strong_points", []),
        score_history=request.records,
        warnings=result.get("warnings", []),
        recommendations=result.get("recommendations", []),
        attention_needed=bool(result.get("attention_needed", False)),
        radar_data=radar_data,
        trend_data=trend_data,
        ai_generated=ai_generated,
    )


def analyze_class(request: ClassInsightRequest) -> ClassInsightResponse:
    """
    分析班级整体学情。

    Parameters
    ----------
    request : ClassInsightRequest
        班级分析请求。

    Returns
    -------
    ClassInsightResponse
        班级学情报告。
    """
    # 逐个分析学生
    student_results = []
    for sr in request.students:
        result = analyze_student(sr)
        student_results.append(result)

    n = len(student_results)
    if n == 0:
        return ClassInsightResponse(course_name=request.course_name)

    # 统计
    avg_score = sum(s.overall_score for s in student_results) / n
    pass_count = sum(1 for s in student_results if s.overall_score >= 60)
    excellent_count = sum(1 for s in student_results if s.overall_score >= 90)

    # 分数分布
    distribution = {
        "优秀(≥90)": sum(1 for s in student_results if s.overall_score >= 90),
        "良好(80-89)": sum(1 for s in student_results if 80 <= s.overall_score < 90),
        "中等(70-79)": sum(1 for s in student_results if 70 <= s.overall_score < 80),
        "及格(60-69)": sum(1 for s in student_results if 60 <= s.overall_score < 70),
        "不及格(<60)": sum(1 for s in student_results if s.overall_score < 60),
    }

    # 弱点排名
    weak_counter: dict[str, int] = {}
    for s in student_results:
        for w in s.weak_points:
            weak_counter[w] = weak_counter.get(w, 0) + 1
    weak_ranking = sorted(
        [{"point": k, "count": v} for k, v in weak_counter.items()],
        key=lambda x: -x["count"],
    )[:10]

    # 重点关注名单
    attention_list = [
        {
            "student_id": s.student_id,
            "score": s.overall_score,
            "warnings": s.warnings,
        }
        for s in student_results if s.attention_needed
    ]

    return ClassInsightResponse(
        course_name=request.course_name,
        student_count=n,
        class_avg_score=round(avg_score, 1),
        pass_rate=round(pass_count / n * 100, 1) if n else 0,
        excellent_rate=round(excellent_count / n * 100, 1) if n else 0,
        distribution=distribution,
        weak_points_ranking=weak_ranking,
        attention_list=attention_list,
    )
