"""
AI 教学辅助服务 — 重难点分析 / 课件优化 / 试题改编 / 课堂辅助。

覆盖比赛要求的完整教学闭环：
备课 → 重难点分析 → 出题 → 批改 → 学情 → 课堂辅助
"""

from __future__ import annotations

from app.core.llm import chat_json, chat_with_prompt


# ═══════════════════════════════════════════════════════════
# 场景2：章节重难点拆解 + 教学突破方案
# ═══════════════════════════════════════════════════════════

SCENE2_SYSTEM_PROMPT = """【当前任务：学科章节重难点智能分析与教学突破方案】
请针对指定课程章节，完成高校教师教学备课深度分析。

输出内容必须包含：
1. 本章全部核心知识点分级：基础知识点、重点知识点、难点知识点、易混淆知识点、学科前沿拓展点
2. 每一个教学难点的：学生错误成因、理解卡点、认知误区
3. 三套差异化教学讲解方案：通俗类比教学法、专业理论推导法、科研案例导入法
4. 配套当堂辨析思考题、易错辨析题
5. 本章教学避坑指南（教师授课常见问题）
6. 本章优质教学资源推荐（教材页码、核心文献、行业标准）

全部内容标注权威来源，末尾添加 AI 生成标识。

输出 JSON 格式：
{
  "knowledge_points": {
    "basic": [{"name": "", "description": "", "source": ""}],
    "important": [{"name": "", "description": "", "source": ""}],
    "difficult": [{"name": "", "description": "", "source": ""}],
    "confusable": [{"name": "", "confusion": "", "clarification": "", "source": ""}],
    "frontier": [{"name": "", "description": "", "source": ""}]
  },
  "difficulty_analysis": [
    {"point": "", "error_cause": "", "understanding_blocker": "", "misconception": ""}
  ],
  "teaching_strategies": [
    {"point": "", "analogy_method": "", "theoretical_method": "", "case_method": ""}
  ],
  "classroom_questions": [{"type": "辨析|思考", "question": "", "answer": "", "source": ""}],
  "teaching_pitfalls": ["常见教学失误1", "正确做法"],
  "recommended_resources": [{"type": "教材|文献|标准", "reference": "", "pages": ""}]
}"""


# ═══════════════════════════════════════════════════════════
# 场景5：原题变式改编 — 一题多考、题库扩充
# ═══════════════════════════════════════════════════════════

SCENE5_SYSTEM_PROMPT = """【当前任务：专业试题智能变式改编】
基于提供的原始题目，生成多维度变式题，用于教师题库建设、课堂训练、作业布置。

改编维度：
1. 替换场景、替换数据、替换案例
2. 改变设问角度、改变考察深度
3. 升级难度、增加综合性
4. 转换题型（简答转论述、计算转综合、案例转分析）

每道变式题包含：题目、答案、解析、易错点、命题出处。
末尾添加 AI 生成标识。

输出 JSON 格式：
{
  "original": {"question": "", "answer": "", "source": ""},
  "variants": [
    {
      "variant_type": "场景替换|设问改变|难度升级|题型转换",
      "question": "",
      "answer": "",
      "explanation": "",
      "common_mistakes": "",
      "source": "",
      "difficulty": "基础|提高|综合"
    }
  ]
}"""


# ═══════════════════════════════════════════════════════════
# 场景8：课堂智能辅助 — 互动素材、提问、讨论、结课
# ═══════════════════════════════════════════════════════════

SCENE8_SYSTEM_PROMPT = """【当前任务：课堂实时教学助教辅助】
根据当前授课章节，为教师生成全套课堂互动教学素材。

输出内容：
1. 课堂导入问题（引发思考，链接已学知识）
2. 当堂随堂提问（分层提问：基础/进阶/创新）
3. 小组讨论主题+讨论指引+输出要求
4. 课堂当堂小测题目（快速检验掌握度，3-5题）
5. 课堂知识总结框架（可直接课堂收尾总结用）
6. 课堂易错即时提醒

内容贴合本科教学、适配一流学科能力培养。
末尾添加 AI 生成标识。

输出 JSON 格式：
{
  "warmup_questions": [{"question": "", "purpose": "", "expected_answer": ""}],
  "layered_questions": {
    "basic": [{"question": "", "answer": ""}],
    "advanced": [{"question": "", "answer": ""}],
    "innovative": [{"question": "", "hint": ""}]
  },
  "discussion_topics": [{"topic": "", "guidance": "", "deliverable": "", "time": 15}],
  "quick_quiz": [{"question": "", "type": "选择|判断", "options": [], "answer": "", "source": ""}],
  "summary_framework": {"key_points": [], "mind_map": "", "takeaway": ""},
  "instant_reminders": ["学生容易出错的即时提醒1"]
}"""


# ── 场景2：重难点分析 ──────────────────────────────────

def analyze_difficult_points(course: str, chapter: str) -> dict:
    """分析章节重难点，生成教学突破方案。"""
    user_prompt = f"""请分析以下课程章节的重难点：

课程名称：{course}
章节名称：{chapter}

请输出完整的重难点分析与教学突破方案。"""
    try:
        return chat_json(
            messages=[
                {"role": "system", "content": SCENE2_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
        )
    except Exception:
        return {"knowledge_points": {}, "difficulty_analysis": [], "teaching_strategies": [],
                "classroom_questions": [], "teaching_pitfalls": [], "recommended_resources": []}


# ── 场景5：试题变式改编 ────────────────────────────────

def generate_variants(original_question: str, original_answer: str = "",
                      course: str = "", chapter: str = "") -> dict:
    """基于原题生成多维度变式题。"""
    user_prompt = f"""请对以下题目进行变式改编：

课程：{course}
章节：{chapter}

原始题目：
{original_question}

原始答案：
{original_answer}

请从场景替换、设问改变、难度升级、题型转换四个维度生成变式题。"""
    try:
        return chat_json(
            messages=[
                {"role": "system", "content": SCENE5_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.5,
        )
    except Exception:
        return {"original": {"question": original_question}, "variants": []}


# ── 场景8：课堂辅助 ────────────────────────────────────

def generate_classroom_materials(course: str, chapter: str) -> dict:
    """生成课堂互动教学素材。"""
    user_prompt = f"""请为以下课堂生成实时教学辅助素材：

课程名称：{course}
授课章节：{chapter}

包括课堂导入、分层提问、讨论主题、随堂小测、总结框架。"""
    try:
        return chat_json(
            messages=[
                {"role": "system", "content": SCENE8_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
        )
    except Exception:
        return {"warmup_questions": [], "layered_questions": {}, "discussion_topics": [],
                "quick_quiz": [], "summary_framework": {}, "instant_reminders": []}


# ── 场景3：课件优化 ────────────────────────────────────

SCENE3_SYSTEM_PROMPT = """【当前任务：学科课程PPT智能优化与教学重构】
基于上传的原始PPT内容，按照高校一流学科教学标准，全自动优化重构。

优化维度：
1. 逻辑重构：修正混乱结构、梳理知识脉络、建立章节前后关联
2. 内容升级：补充重难点解析、补充前沿科研案例、补充课堂互动
3. 教学适配：增加教师授课话术、过渡语、课堂引导点
4. 规范优化：统一学科专业术语、修正不严谨表述、补充公式模型
5. 能力导向：增加学生能力训练点、创新思考点、课堂探究任务

输出结构化、可直接替换的高质量课件内容，标注知识来源。
末尾添加 AI 生成标识。

输出 JSON 格式：
{
  "original_issues": [{"issue": "", "severity": "高|中|低", "suggestion": ""}],
  "restructured_content": [
    {"slide_section": "", "original": "", "optimized": "", "rationale": ""}
  ],
  "added_content": [{"type": "案例|互动|前沿", "content": "", "source": ""}],
  "teaching_scripts": [{"slide": "", "transition": "", "teacher_talk": "", "guidance": ""}],
  "terminology_corrections": [{"original": "", "corrected": "", "reason": ""}],
  "ability_training": [{"point": "", "training_method": "", "classroom_activity": ""}]
}"""


def optimize_ppt(ppt_content: str, course: str = "", chapter: str = "") -> dict:
    """优化课件PPT内容。"""
    user_prompt = f"""请优化以下课件内容：

课程：{course}
章节：{chapter}

原始课件内容：
{ppt_content}"""
    try:
        return chat_json(
            messages=[
                {"role": "system", "content": SCENE3_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
        )
    except Exception:
        return {"original_issues": [], "restructured_content": [], "added_content": [],
                "teaching_scripts": [], "terminology_corrections": [], "ability_training": []}
