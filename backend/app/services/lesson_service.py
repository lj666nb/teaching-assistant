"""
智能备课服务 — 基于 LLM + RAG 自动生成教案。

核心功能：
1. 根据课程名称和章节生成完整教案
2. 支持教材内容增强（RAG）
3. 支持自定义教学要求
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

from app.core.llm import chat_json, chat_with_prompt
from app.models.schemas import (
    LessonPlanRequest,
    LessonPlanResponse,
    SessionPlan,
    TeachingActivity,
    TeachingObjective,
)
from app.services.rag_service import generate_with_rag


SYSTEM_PROMPT = """【当前任务：高校本科专业课完整课时教案生成】
你是一流学科建设专家型教师，请生成一份可直接用于课堂授课的标准化本科教案。
每个教学环节必须极其详细，确保新教师拿到就能直接上课。

【数学符号强制规范 —— 极其重要！】
所有数学表达式必须使用国际标准数学符号，禁止用中文词语描述数学运算。
以下对照表为最低标准，有标准符号的一律用符号：

❌ 错误写法              → ✅ 正确写法
x的n次方求和              → ∑ₙ₌₀ᵐ xⁿ  或  Σ xⁿ (n=0,1,2,…)
a_n乘以x的n次方          → aₙxⁿ  或  ∑ aₙxⁿ
f对x求导                  → df/dx  或  f'(x)  或  ∂f/∂x
f对x求二阶导             → f″(x)  或  d²f/dx²
f(x)从a到b的定积分       → ∫ₐᵇ f(x)dx
x趋近于无穷大的极限      → lim_{x→∞}
x趋近于0                  → x→0  或  lim_{x→0}
属于、包含于             → ∈、⊂、⊆
空集、任意、存在         → ∅、∀、∃
阿尔法、贝塔、伽马       → α、β、γ
德尔塔、西格玛、派       → Δ/δ、Σ/σ、π
乘号                      → ×  或  ·  (不用字母x代替)
向量x                     → x⃗  或  𝐱
矩阵A                     → 𝐀
无穷大                    → ∞
小于等于、大于等于       → ≤、≥
不等于、约等于           → ≠、≈
平方根、立方根           → √、∛
x的平方、x的n次方        → x²、xⁿ
下标                      → x₁、aₙ₊₁  (尽量用Unicode下标)
分式                      → ½、⅔  或  a/b  或  \frac{a}{b}

【分数的标准表示 —— 严禁用中文文字描述分数】
❌ "二分之一" "三分之一"     → ✅ 1/2、1/3  或  Unicode ½、⅓
❌ "a分之b" "b除以a"         → ✅ b/a
❌ "x加1分之x减1"            → ✅ (x−1)/(x+1)
❌ "2的2分之1次方"          → ✅ 2^(1/2)  或  √2
❌ "n阶乘分之x的n次方"     → ✅ xⁿ/n!

分数书写规则：
- 简单分数用对角线形式：a/b、1/2、(x+1)/(x−1)
- 常见分数用 Unicode：½ ⅓ ⅔ ¼ ¾ ⅕ ⅖ ⅗ ⅘ ⅙ ⅚ ⅛ ⅜ ⅝ ⅞
- 分子或分母含运算时必须加括号：(x²+1)/(x−1) ≠ x²+1/x−1
- 导数定义：f′(x) = lim_{h→0} (f(x+h)−f(x))/h

对于幂级数、泰勒展开等，严格使用标准数学表达：
✅ f(x) = Σₙ₌₀ᐁ aₙ(x − x₀)ⁿ = a₀ + a₁(x−x₀) + a₂(x−x₀)² + …
✅ eˣ = Σₙ₌₀ᐁ xⁿ/n! = 1 + x + x²/2! + x³/3! + …
✅ sin x = Σₙ₌₀ᐁ (−1)ⁿx²ⁿ⁺¹/(2n+1)!

【语言要求】
- 说明性文字、教学用语使用中文输出
- 专业术语优先使用中文全称，国际通用缩写可用原文
- 软件/工具名可用原文加中文说明
- 示例代码的变量名、函数名用英文，注释用中文

教案必须包含以下完整结构化内容，输出 JSON 格式：

1. 课程基本信息（course_info）：
   - title, chapter, prerequisites（前置知识点数组）
   - key_points（教学重点数组，至少3项）、difficult_points（教学难点数组，至少3项）
   - objectives（三维教学目标数组，每项含 dimension 和 content）

2. 学情分析（learner_analysis）：
   - common_misconceptions（常见误区数组）
   - difficult_areas（理解难点数组）
   - weak_abilities（能力薄弱点数组）

3. ⭐ 教学流程（teaching_flow，按15分钟切片，最重要）：
   每个时段必须包含以下字段，缺一不可：
   - time_slot: 时间段标签，如 "0-15min", "15-30min"
   - activity_type: 活动类型，必须是以下之一：导入 | 讲授 | 讨论 | 练习 | 演示 | 实验 | 总结 | 互动
   - content (80-150字)：教学内容叙述，包含概念定义、公式推导、逻辑推理
   - teacher_talk (100-200字)：教师讲解脚本，可直接照着讲，用口语化表达
   - interaction (50-100字)：师生互动设计，包含提问、预期回答、引导策略
   - example (80-200字)：⭐ 极其重要！完整教学示例，含具体数据/推导/代码/答案
   - case (30-60字)：引导性案例或引入故事

4. ⭐ 教学方法（methods，至少3项）：从以下列表中选取
   讲授法、案例教学法、讨论法、演示法、练习法、探究法、翻转课堂、小组合作、项目式学习、问题驱动教学

5. ⭐ 教学资源（resources，至少3项）：从以下列表中选取
   教材、多媒体课件、在线学习平台、板书、实验设备、视频资料、代码示例、数据集、文献资料、教学模型

6. 板书设计（board_design）：structure（板书布局描述）+ key_formulas（关键公式/图表数组）

7. 分层课堂任务（class_tasks）：基础/提升/创新三级，每题含 level/content/source

8. 分层课后作业（homework）：巩固/应用/拓展三级，每题含 level/content/answer_hint

9. 考核标准（assessment）：evaluation_standards（评分标准数组）+ rubric（评价量规数组）

10. 教学创新（innovation）：frontier_cases（学科前沿案例数组）+ research_integration（科研反哺描述）+ ideological_political（课程思政融入点）

所有知识点标注权威来源。末尾加 AI 生成标识。

JSON 格式：
{
  "course_info": {"title":"", "chapter":"", "prerequisites":[], "key_points":[], "difficult_points":[], "objectives":[{"dimension":"知识|能力|素养", "content":""}]},
  "learner_analysis": {"common_misconceptions":[], "difficult_areas":[], "weak_abilities":[]},
  "methods": ["讲授法","案例教学法","讨论法"],
  "resources": ["教材","多媒体课件","在线学习平台"],
  "teaching_flow": [
    {"time_slot":"0-15min", "activity_type":"导入", "content":"...", "teacher_talk":"...", "interaction":"...", "example":"...", "case":"..."},
    {"time_slot":"15-30min", "activity_type":"讲授", "content":"...", "teacher_talk":"...", "interaction":"...", "example":"...", "case":"..."}
  ],
  "board_design": {"structure":"", "key_formulas":[]},
  "class_tasks": [{"level":"基础|提升|创新", "content":"", "source":""}],
  "homework": [{"level":"巩固|应用|拓展", "content":"", "answer_hint":""}],
  "assessment": {"evaluation_standards":[], "rubric":[]},
  "innovation": {"frontier_cases":[], "research_integration":"", "ideological_political":""}
}"""


def generate_lesson_plan(request: LessonPlanRequest) -> LessonPlanResponse:
    """
    生成教案。

    流程：
    1. 通过 RAG 检索教材相关内容（如果有课程/章节信息）
    2. 构建提示词调用 LLM
    3. 解析结构化输出
    4. 返回完整教案
    """
    # 检测 API Key 是否已配置
    from app.core.llm import _resolve_api_key
    api_key = _resolve_api_key()
    if not api_key or api_key.strip() in ("", "your-api-key-here", "your-key-here", "sk-your-api-key"):
        raise ValueError(
            "LLM API Key 未配置，请在页面右上角「设置」中配置 API Key。"
            "支持 DeepSeek / 讯飞星火 / OpenAI 等兼容接口。"
        )

    # 尝试从知识库检索教材内容
    textbook_context = request.textbook_content
    if not textbook_context and request.course_name:
        try:
            from app.services.knowledge_base import search as kb_search
            chunks = kb_search(
                f"{request.course_name} {request.chapter}",
                course=request.course_name,
                top_k=10,
            )
            if chunks:
                textbook_context = "\n".join(
                    f"[{c.source}] {c.content}" for c in chunks
                )
        except Exception:
            pass

    # 计算预计教学时段数（每课时约45分钟有效教学时间）
    total_minutes = request.teaching_hours * 45
    expected_slices = max(1, total_minutes // 15)  # 每15分钟一个时段（减少LLM输出量，提速）

    # 构建用户提示
    user_prompt = f"""请为以下课程设计教案：

课程名称：{request.course_name}
章节名称：{request.chapter}
课时数：{request.teaching_hours} 课时（每课时45分钟，共约 {total_minutes} 分钟有效教学时间）
附加要求：{request.additional_requirements or "无"}

【重要】teaching_flow 数组必须恰好包含 {expected_slices} 个教学时段（每15分钟一个切片），
覆盖全部 {request.teaching_hours} 课时的教学内容。每个时段必须包含完整的讲解脚本和教学示例。

【语言要求】说明性文字使用中文。数学符号、公式使用国际标准符号（如 ∑ ∫ α β ∂ x² 等）。变量名、代码可用英文。

教材内容（供参考）：
{textbook_context[:8000] if textbook_context else "（未提供教材内容，请基于学科常识设计）"}
"""

    # 调用 LLM（JSON 模式）
    try:
        result = chat_json(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
            max_tokens=12288,  # 支持完整教案 JSON 输出，避免截断导致降级
        )

        # 兼容新旧两种格式解析
        course_info = result.get("course_info", {})

        # 教学目标：新格式 course_info.objectives / 旧格式 objectives
        objectives_raw = course_info.get("objectives", result.get("objectives", []))
        objectives = [TeachingObjective(**o) for o in objectives_raw if isinstance(o, dict)]

        # 教学流程解析
        flow = result.get("teaching_flow", [])
        sessions_data = result.get("sessions", [])

        sessions = []
        if flow:
            # ── 新格式：每个时间切片 → 独立的 TeachingActivity ──
            # 按课时分组（每课时45分钟有效教学时间，3个15分钟切片）
            slices_per_hour = max(1, total_minutes // (15 * request.teaching_hours)
                                  if request.teaching_hours > 0 else 3)
            # 更简单的分组：总共 N 个切片，分配到 teaching_hours 个课时
            total_slices = len(flow)
            slices_per_session = max(1, total_slices // max(1, request.teaching_hours))

            for hour_idx in range(request.teaching_hours):
                start_slice = hour_idx * slices_per_session
                end_slice = min(start_slice + slices_per_session, total_slices) if hour_idx < request.teaching_hours - 1 else total_slices
                group = flow[start_slice:end_slice]

                if not group:
                    continue

                session_idx = hour_idx + 1

                # 每个时间切片 → 一个 TeachingActivity（不再合并！）
                activities = []
                for s in group:
                    dur = 15  # 每切片 15 分钟
                    atype = s.get("activity_type", "讲授")
                    content = s.get("content", "")
                    teacher = s.get("teacher_talk", s.get("teacher_activity", ""))
                    student = s.get("interaction", s.get("student_activity", ""))
                    ex = s.get("example", s.get("case", ""))

                    activities.append(TeachingActivity(
                        duration=dur,
                        activity_type=atype,
                        content=content,
                        teacher_activity=teacher,
                        student_activity=student,
                        example=ex,
                    ))

                # 课时主题：优先用第一个切片的 activity_type + content 摘要
                first = group[0]
                topic_type = first.get("activity_type", "")
                topic_content = first.get("content", "")[:40]
                time_label = f"{start_slice * 15}-{min(end_slice * 15, total_minutes)}min"
                session_topic = f"【{time_label}】{topic_type}：{topic_content}"

                sessions.append(SessionPlan(
                    session_order=session_idx,
                    session_topic=session_topic,
                    activities=activities,
                    key_points=course_info.get("key_points", []),
                    difficult_points=course_info.get("difficult_points", []),
                    homework="",
                ))
        else:
            # ── 旧格式兼容 ──
            for s in sessions_data:
                activities = [
                    TeachingActivity(
                        duration=a.get("duration", 10),
                        activity_type=a.get("activity_type", "讲授"),
                        content=a.get("content", ""),
                        teacher_activity=a.get("teacher_activity", a.get("teacher_talk", "")),
                        student_activity=a.get("student_activity", a.get("interaction", "")),
                        example=a.get("example", a.get("case", "")),
                    ) for a in s.get("activities", [])
                ]
                s_objectives = [
                    TeachingObjective(**o) for o in s.get("objectives", [])
                ]
                sessions.append(SessionPlan(
                    session_order=s.get("session_order", 1),
                    session_topic=s.get("session_topic", ""),
                    objectives=s_objectives,
                    key_points=s.get("key_points", []),
                    difficult_points=s.get("difficult_points", []),
                    activities=activities,
                    homework=s.get("homework", ""),
                ))

        # ── 提取分层课后作业 ──
        homework_list = result.get("homework", [])
        if not homework_list and isinstance(result.get("homework"), str):
            homework_list = [{"level": "课后作业", "content": result["homework"], "answer_hint": ""}]
        homework_text = "\n".join(
            f"[{h.get('level', '')}] {h.get('content', '')}"
            for h in homework_list
        ) if homework_list else ""

        # 最后一条 session 补充作业文本
        if homework_text and sessions:
            sessions[-1].homework = homework_text

        # ── 提取之前被丢弃的辅助模块 ──
        board_design = result.get("board_design", {})
        class_tasks = result.get("class_tasks", [])
        assessment = result.get("assessment", {})
        innovation = result.get("innovation", {})
        learner_analysis = result.get("learner_analysis", {})

        return LessonPlanResponse(
            id=str(uuid.uuid4())[:8],
            course_name=request.course_name,
            chapter=request.chapter,
            total_hours=request.teaching_hours,
            objectives=objectives,
            methods=result.get("methods", course_info.get("methods", [])),
            resources=result.get("resources", course_info.get("resources", [])),
            sessions=sessions or None,
            board_design=board_design,
            class_tasks=class_tasks,
            homework=homework_list,
            assessment=assessment,
            innovation=innovation,
            learner_analysis=learner_analysis,
            created_at=datetime.now().isoformat(),
        )

    except Exception as e:
        # 降级方案：LLM 调用失败时使用结构化模板（非 AI 生成）
        import logging
        logging.getLogger(__name__).warning(f"LLM 教案生成失败，使用降级方案: {e}")
        course = request.course_name
        chapter = request.chapter
        hours = request.teaching_hours
        fallback_sessions = []
        for hour in range(1, hours + 1):
            activities = []
            if hour == 1:
                activities = [
                    TeachingActivity(
                        duration=10, activity_type="导入",
                        content=f"【{course}】{chapter} — 课程导入与概览",
                        teacher_activity=f"向学生介绍本章在{course}课程体系中的位置与重要性，"
                                        f"简要概述{chapter}将要学习的核心内容，激发学生学习兴趣。"
                                        f"建议以实际行业案例或科研问题作为切入点，"
                                        f"让学生理解本章知识的实际应用价值。",
                        student_activity=f"阅读教材{chapter}对应章节的前言部分，"
                                         f"思考本章知识与已学内容的联系，"
                                         f"提出自己感兴趣的问题。",
                        example=f"【教学示例】以{course}领域中与{chapter}相关的经典问题为例，"
                                f"展示该章节知识可以解决的问题类型，"
                                f"引导学生建立学习目标。",
                    ),
                    TeachingActivity(
                        duration=15, activity_type="讲授",
                        content=f"【{course}】{chapter} — 核心概念讲解",
                        teacher_activity=f"系统讲授{chapter}的基础概念和定义，"
                                        f"板书关键术语并逐一解释。"
                                        f"通过对比易混淆概念帮助学生建立清晰的知识框架。"
                                        f"强调本节内容在后续学习中的基础性作用。",
                        student_activity=f"在教材上标注重点概念，"
                                         f"记录关键定义和公式，"
                                         f"回答教师提出的概念辨析问题。",
                        example=f"【教学示例】对{chapter}涉及的每个核心概念，"
                                f"给出2-3个正例和反例，帮助学生准确理解概念边界。",
                    ),
                    TeachingActivity(
                        duration=15, activity_type="互动讨论",
                        content=f"【{course}】{chapter} — 课堂互动与深化理解",
                        teacher_activity=f"提出2-3个与{chapter}相关的思考题，"
                                        f"组织学生分组讨论（每组4-6人），"
                                        f"巡视各组讨论情况，适时引导。"
                                        f"讨论结束后请各组代表发言，教师点评总结。",
                        student_activity=f"分组讨论教师提出的问题，"
                                         f"每组推选代表汇报讨论结果，"
                                         f"对其他组的观点进行补充或质疑。",
                        example=f"【讨论题示例】"
                                f"1. {chapter}的核心思想在{course}中处于什么地位？"
                                f"2. 举一个生活中的例子说明{chapter}相关概念。"
                                f"3. {chapter}与前面学过的内容有什么联系？",
                    ),
                    TeachingActivity(
                        duration=5, activity_type="总结",
                        content=f"【{course}】{chapter} — 本课时小结",
                        teacher_activity=f"回顾本课时重点内容："
                                        f"（1）{chapter}的核心概念体系；"
                                        f"（2）关键定义与公式；"
                                        f"（3）与前后章节的逻辑关系。"
                                        f"布置课后阅读任务和思考题。",
                        student_activity=f"对照教师总结自查笔记完整性，"
                                         f"记录课后任务。",
                        example="",
                    ),
                ]
            else:
                activities = [
                    TeachingActivity(
                        duration=5, activity_type="复习导入",
                        content=f"【{course}】{chapter} — 上节回顾与本课导入",
                        teacher_activity=f"快速回顾上一课时的核心内容（3分钟），"
                                        f"通过提问检查学生掌握情况。"
                                        f"引出本课时将要学习的进阶内容，"
                                        f"说明前后内容的逻辑递进关系。",
                        student_activity=f"回答教师提问，"
                                         f"快速浏览教材中本课时对应内容。",
                        example=f"【复习题】请简述{chapter}的核心概念及其相互关系。",
                    ),
                    TeachingActivity(
                        duration=20, activity_type="深入讲授",
                        content=f"【{course}】{chapter} — 进阶内容与综合应用",
                        teacher_activity=f"在基础概念之上，深入讲解{chapter}的进阶内容。"
                                        f"通过具体案例展示知识的综合运用方法。"
                                        f"板书推导关键步骤，强调常见错误和注意事项。"
                                        f"适时穿插提问，保持学生注意力。",
                        student_activity=f"跟随教师推导过程记录要点，"
                                         f"独立完成课堂练习题，"
                                         f"标记不理解的内容及时提问。",
                        example=f"【综合案例】给出一个融合{course}多章节知识的实际问题，"
                                f"带领学生逐步分析→建模→求解→验证，"
                                f"展示完整的知识运用流程。",
                    ),
                    TeachingActivity(
                        duration=15, activity_type="练习巩固",
                        content=f"【{course}】{chapter} — 课堂练习与即时反馈",
                        teacher_activity=f"布置2-3道课堂练习题（由易到难），"
                                        f"给学生独立完成时间（10分钟），"
                                        f"然后逐题讲解，重点关注学生易错点。"
                                        f"对完成较快的学生提供附加挑战题。",
                        student_activity=f"独立完成课堂练习题，"
                                         f"对照教师讲解自查错误，"
                                         f"记录自己的薄弱环节。",
                        example=f"【练习题】设计涵盖{chapter}核心知识点的练习题，"
                                f"包含基础题（60%）、提高题（30%）、挑战题（10%）。",
                    ),
                    TeachingActivity(
                        duration=5, activity_type="总结",
                        content=f"【{course}】{chapter} — 本课时小结与课后任务",
                        teacher_activity=f"梳理本课时知识框架，"
                                        f"预告下一课时内容，"
                                        f"布置课后作业与预习任务。",
                        student_activity=f"整理笔记，"
                                         f"记录课后任务。",
                        example="",
                    ),
                ]
            fallback_sessions.append(SessionPlan(
                session_order=hour,
                session_topic=f"第{hour}课时：{course} — {chapter}",
                key_points=[f"{chapter}核心概念体系", f"{chapter}基本原理与方法"],
                difficult_points=[f"{chapter}综合应用", f"理论联系实际"],
                activities=activities,
                homework=f"1. 复习教材{chapter}章节，整理知识框架图\n"
                         f"2. 完成课后习题\n"
                         f"3. 预习下一课时内容" if hour == hours else f"预习第{hour+1}课时内容",
            ))

        return LessonPlanResponse(
            id=str(uuid.uuid4())[:8],
            course_name=course,
            chapter=chapter,
            total_hours=hours,
            objectives=[
                TeachingObjective(dimension="知识", content=f"掌握{chapter}的核心概念、基本原理和方法体系"),
                TeachingObjective(dimension="能力", content=f"能够运用{chapter}的知识分析和解决实际问题"),
                TeachingObjective(dimension="素养", content=f"培养科学思维、批判性思考和自主学习能力"),
            ],
            methods=["讲授法", "互动讨论法", "案例教学法", "练习法"],
            resources=["教材", "多媒体课件", "板书", "在线学习平台"],
            sessions=fallback_sessions,
            created_at=datetime.now().isoformat(),
            is_fallback=True,
        )
