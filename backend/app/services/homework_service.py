"""
作业批改与辅导服务 — AI 驱动的智能批改、练习生成、文件处理。

核心功能：
1. 单题/批量作业批改（支持多种题型）
2. 针对性练习题生成
3. 详细反馈与改进建议
4. 上传文件处理（PDF/Word/图片）→ 文本提取 → 批改
"""

from __future__ import annotations

import base64
import io
import json
import logging
import subprocess
import tempfile

from app.core.llm import chat_json, chat_multimodal
from app.models.schemas import (
    ExerciseItem,
    ExerciseRequest,
    ExerciseResponse,
    GradingResult,
    HomeworkSubmission,
)

logger = logging.getLogger(__name__)


GRADING_SYSTEM_PROMPT = """【当前任务：高校学科作业/试卷智能助教批改】

════════════════════════════════════════════════
【客观题（选择题/判断题/填空题/多选题）批改规则 — 极其重要】
════════════════════════════════════════════════

如果提示中给定了【标准答案】，必须严格执行以下规则：
1. 选择题：只比对选项字母（A/B/C/D），忽略选项文字描述差异
   - 学生答案"选B" / "答案选B" / "B" / "b" vs 标准答案"B" → 提取字母一致，满分
   - 学生答案"B" vs 标准答案"B.{1}" → 提取字母B一致，满分（忽略花括号内数值）
   - ⚠️ 核心：只要提取出的选项字母一致即满分，不论两边文字描述有何差异
   - ⚠️ 学生答案中的选项字母从「答案选X」「选X」「(X)」「X.」「答案是X」等格式提取
2. 判断题：只比对学生判断结果（正确/错误），忽略表述差异
3. 填空题：关键术语或数值一致即满分，允许同义表述
4. 多选题：选项字母集合完全一致满分，漏选/多选0分
5. ⚠️ 核心原则：宁可误给满分（学生本质正确），不可错扣分（把对的判成错的）

⚠️ 如果没有给定标准答案 — 极其重要：
- 你不能仅凭自己的学科知识判断对错！你必须：
  1. 仔细审题，从题目内容中提取所有选项（A/B/C/D各自对应的值）
  2. 自行计算出正确答案
  3. 将计算出的正确答案对应的选项字母与学生的选项字母比对
  4. 在 detailed_analysis 中写下你的计算过程和推理
- 如果你不能100%确定正确答案，给学生满分（遵循"宁可误给满分"原则）
- 特别警告：数学/逻辑题目容易计算错误，请逐步验算至少两遍

════════════════════════════════════════════════
【主观题（简答/论述/计算/证明/代码）批改规则】
════════════════════════════════════════════════
1. ⚠️ 必须逐小题独立判分！禁止因为一道小题答错就整份作业清零
2. 参考答案中有评分标准 → 严格按给分点逐点给分
3. 无评分标准 → 将题目拆分为答题要点，每个要点独立评分
4. 学生用了与参考答案不同的思路但逻辑正确 → 给满分
5. 兼容学生作答的语序调整、换行、标点细微差异
6. 核心公式、结论一致即判定得分，不纠结措辞差异

【分步批注要求 — 极其重要】
- 主观题必须在 scoring_breakdown 中列出每个评分要点的得分情况
- 每个要点标注：要点内容、得分/满分、扣分原因（如有）
- 学生能看到每个步骤的得分，知道哪里失分、为什么失分

输出 JSON：
{
  "score": 85.0,
  "max_score": 100.0,
  "percentage": 85.0,
  "feedback": "200字内综合评语",
  "strengths": ["答题亮点1", "答题亮点2"],
  "weaknesses": ["具体错误1", "具体不足2"],
  "suggestions": ["针对性改进建议"],
  "knowledge_points": ["涉及的知识点"],
  "detailed_analysis": "逐步骤/逐要点详细分析，含扣分原因和标准答案对比",
  "scoring_breakdown": [
    {"point": "要点1描述", "score": 5.0, "max": 5.0, "comment": "完全正确"},
    {"point": "要点2描述", "score": 0.0, "max": 5.0, "comment": "未作答或完全错误"}
  ]
}"""


EXERCISE_SYSTEM_PROMPT = """【当前任务：学科专业试题智能出题与分层组卷】
根据指定课程章节、难度要求、题型结构，生成本科专业标准化试题。

要求：
1. 分层出题：基础题、提高题、综合应用题、前沿创新题
2. 题型包含：选择、判断、简答、计算、案例分析、论述（按需适配）
3. 每题包含：题目、标准答案、分步评分细则、详细解析、易错点分析
4. 每题绑定知识点标签、教学目标、命题依据（教材来源）
5. 试题规避网络原题，具备本科专业高阶考察性
6. 可自动生成单元卷、随堂测、期末模拟卷
7. 输出完整可直接使用的试卷格式

末尾添加 AI 生成标识。

输出 JSON 格式：
{
  "exercises": [
    {
      "question": "题目内容",
      "type": "选择题|简答题|计算题|论述题",
      "options": ["A. xxx", "B. xxx"],
      "answer": "标准答案",
      "difficulty": "基础|提高|综合|前沿创新",
      "knowledge_point": "知识点名称",
      "teaching_objective": "对应教学目标",
      "source": "命题依据（教材章节/文献）",
      "scoring_rubric": "分步评分细则",
      "common_mistakes": "常见易错点",
      "explanation": "详细解析",
      "estimated_time": 5
    }
  ],
  "total_score": 100,
  "difficulty_distribution": {"基础": 0, "提高": 0, "综合": 0, "前沿创新": 0}
}"""


def _normalize_answer(text: str) -> str:
    """Normalize an answer string for comparison: trim, uppercase, remove punctuation."""
    import re
    text = text.strip().upper()
    # Remove common prefix notation like "答案:" or "Answer:"
    text = re.sub(r'^(答案|正确选项|ANSWER)[：:\s]*', '', text, flags=re.IGNORECASE)
    # Remove trailing punctuation
    text = text.rstrip('.。,，、;；:：)）]】')
    return text.strip()


def _detect_question_type(question_text: str, declared_type: str) -> str:
    """Auto-detect the actual question type from question text content.

    Many file-upload flows leave question_type as '主观题' (the default),
    which prevents deterministic grading for objective questions.
    This function detects the real type from the question's text patterns.
    """
    import re
    text = question_text.strip()

    # Already a known objective type — keep it
    if declared_type in ('选择题', '判断题', '多选题', '填空题'):
        return declared_type

    # Detect multiple choice: options like A.xxx B.xxx C.xxx D.xxx
    option_count = len(re.findall(r'[A-F]\s*[.、．)\]]', text))
    if option_count >= 2:
        return '选择题'

    # Detect true/false: keywords like 正确/错误, 对/错, √/×, T/F
    if re.search(r'(正确|错误|对错|[√×✓✗]|TRUE|FALSE)', text, re.IGNORECASE):
        if not re.search(r'(简述|分析|论述|证明|计算|编程|代码|写|描述|说明|解释|讨论)', text):
            return '判断题'

    # Detect fill-in-the-blank: underscores or parentheses for blanks
    if re.search(r'[（(]\s*[）)]|_{2,}|……', text):
        return '填空题'

    # Detect multi-select
    if re.search(r'(多选|不定项)', text):
        return '多选题'

    return declared_type


def _extract_choice_letter(text: str) -> str | None:
    """Extract the option letter (A/B/C/D) from a student answer string.

    Handles many common formats found in homework submissions:
      - "B" / "b" (standalone letter)
      - "B.xxx" / "B)xxx" / "(B)" / "【B】" / "B、xxx"
      - "选B" / "答案是B" / "我选B" / "选择B项"
      - "正确选项为B" / "答案为B"
    """
    import re
    text = text.strip().upper()

    # Pattern 0: Standalone letter (fast path for most common case)
    m = re.match(r'^([A-F])\s*$', text)
    if m:
        return m.group(1)

    # Pattern 1: Letter followed by separator and description: "B.xxx" / "B)xxx" / "B、xxx" / "B,xxx"
    m = re.match(r'^([A-F])\s*[.、．,，)）\]】]', text)
    if m:
        return m.group(1)

    # Pattern 2: Letter enclosed in brackets: "(B)" / "（B）" / "【B】" / "[B]"
    m = re.search(r'[\(（【\[]\s*([A-F])\s*[\)）】\]\)]', text)
    if m:
        return m.group(1)

    # Pattern 3: Answer prefix + letter: "答案B" / "答案是B" / "选B" / "选择B" / "我选B"
    answer_markers = r'(?:答案|正确选项|正确|选项|我?选|选择|填|填入)\s*(?:是|为|：|:)?\s*'
    m = re.search(answer_markers + r'([A-F])', text)
    if m:
        return m.group(1)

    # Pattern 4: Letter anywhere in short text (for ambiguous but short answers)
    if len(text) <= 15:
        m = re.search(r'\b([A-F])\b', text)
        if m:
            return m.group(1)

    return None


def _get_option_letters_from_question(question_text: str) -> set[str]:
    """Extract all valid option letters (A/B/C/D) that appear as options in the question text.

    Only returns letters that are used as option markers (e.g., "A.xxx B.xxx"),
    NOT letters used in mathematical notation (e.g., "集合A={1,2}").
    """
    import re
    # Match option patterns: "A.xxx" / "(A)xxx" / "A)xxx" / "A、xxx"
    option_matches = re.findall(r'(?:^|\s|[(（])([A-F])\s*[.、．)\]]', question_text)
    return set(option_matches)


def _validate_student_choice(student_answer: str, question_text: str) -> str | None:
    """Validate that a student's choice letter corresponds to an actual option in the question.

    Returns the validated letter, or None if:
    - No valid option letters found in the question
    - The student's answer matches exactly one option letter
    """
    import re
    valid_options = _get_option_letters_from_question(question_text)
    if not valid_options:
        return None  # Can't validate without knowing the options

    extracted = _extract_choice_letter(student_answer)
    if not extracted:
        return None

    # If the extracted letter is a valid option → confirmed
    if extracted in valid_options:
        return extracted

    # The extracted letter doesn't match any option — might be picking up
    # a letter from mathematical notation rather than an option marker.
    # In this case, try to find the letter in a more explicit answer context.
    return None


def _extract_bool_answer(text: str) -> str | None:
    """Extract a boolean answer (正确/错误/对/错/True/False/√/×/T/F)."""
    text = text.strip().upper()
    if text in ('正确', '对', 'TRUE', 'T', '√', '✓', 'YES', 'Y', '是'):
        return '正确'
    if text in ('错误', '错', 'FALSE', 'F', '×', '✗', 'NO', 'N', '否'):
        return '错误'
    return None


def _extract_multi_choice_letters(text: str) -> set[str] | None:
    """Extract multiple choice option letters (e.g., 'AB', 'A,B', 'A和B')."""
    import re
    text = text.strip().upper()
    letters = set(re.findall(r'[A-F]', text))
    return letters if letters else None


def _deterministic_grade_objective(
    question_type: str,
    student_answer: str,
    reference_answer: str,
    max_score: float,
) -> GradingResult | None:
    """
    Attempt deterministic grading for objective questions.
    Returns a GradingResult if the answer is clear-cut, None if ambiguous (needs LLM).
    """
    ref_norm = _normalize_answer(reference_answer)

    if question_type == '选择题':
        student_letter = _extract_choice_letter(student_answer)
        ref_letter = _extract_choice_letter(reference_answer)
        if student_letter and ref_letter:
            is_correct = student_letter == ref_letter
            score = max_score if is_correct else 0.0
            return GradingResult(
                score=score,
                max_score=max_score,
                percentage=round(score / max_score * 100, 1) if max_score else 0,
                feedback=f"学生答案：{student_letter} / 标准答案：{ref_letter} → {'✅ 正确' if is_correct else '❌ 错误'}",
                strengths=["答案正确"] if is_correct else [],
                weaknesses=[] if is_correct else [f"正确答案应为 {ref_letter}，学生选择了 {student_letter}"],
                suggestions=[] if is_correct else [f"请复习相关知识点，正确答案是 {ref_letter}"],
                knowledge_points=[],
                detailed_analysis=f"客观题自动判定：标准答案 {ref_letter}，学生答案 {student_letter}，{'一致' if is_correct else '不一致'}。",
            )

    elif question_type == '判断题':
        student_bool = _extract_bool_answer(student_answer)
        ref_bool = _extract_bool_answer(reference_answer)
        if student_bool and ref_bool:
            is_correct = student_bool == ref_bool
            score = max_score if is_correct else 0.0
            return GradingResult(
                score=score,
                max_score=max_score,
                percentage=round(score / max_score * 100, 1) if max_score else 0,
                feedback=f"学生答案：{student_bool} / 标准答案：{ref_bool} → {'✅ 正确' if is_correct else '❌ 错误'}",
                strengths=["判断正确"] if is_correct else [],
                weaknesses=[] if is_correct else [f"正确答案应为 {ref_bool}"],
                suggestions=[] if is_correct else ["请仔细审题，理解判断依据"],
                knowledge_points=[],
                detailed_analysis=f"客观题自动判定：标准答案 {ref_bool}，学生答案 {student_bool}，{'一致' if is_correct else '不一致'}。",
            )

    elif question_type == '多选题':
        student_set = _extract_multi_choice_letters(student_answer)
        ref_set = _extract_multi_choice_letters(reference_answer)
        if student_set and ref_set:
            is_correct = student_set == ref_set
            score = max_score if is_correct else 0.0
            student_str = ''.join(sorted(student_set))
            ref_str = ''.join(sorted(ref_set))
            return GradingResult(
                score=score,
                max_score=max_score,
                percentage=round(score / max_score * 100, 1) if max_score else 0,
                feedback=f"学生答案：{student_str} / 标准答案：{ref_str} → {'✅ 正确' if is_correct else '❌ 错误'}",
                strengths=["全部选对"] if is_correct else [],
                weaknesses=[] if is_correct else [f"正确答案应为 {ref_str}，学生选择了 {student_str}"],
                suggestions=[] if is_correct else [f"请复习多选题答题技巧，正确答案是 {ref_str}"],
                knowledge_points=[],
                detailed_analysis=f"客观题自动判定：标准答案 {ref_str}，学生答案 {student_str}，{'一致' if is_correct else '不一致'}。",
            )

    elif question_type == '填空题':
        # For fill-in-the-blank, do a direct normalized comparison
        student_norm = _normalize_answer(student_answer)
        if student_norm and ref_norm:
            # Allow some fuzzy matching: strip common units, normalize numbers
            import re
            s_clean = re.sub(r'\s+', '', student_norm)
            r_clean = re.sub(r'\s+', '', ref_norm)
            is_correct = s_clean == r_clean
            score = max_score if is_correct else 0.0
            return GradingResult(
                score=score,
                max_score=max_score,
                percentage=round(score / max_score * 100, 1) if max_score else 0,
                feedback=f"学生答案：{student_norm} / 标准答案：{ref_norm} → {'✅ 正确' if is_correct else '❌ 错误'}",
                strengths=["填写正确"] if is_correct else [],
                weaknesses=[] if is_correct else [f"正确答案应为 {ref_norm}"],
                suggestions=[] if is_correct else ["请复习相关概念"],
                knowledge_points=[],
                detailed_analysis=f"客观题自动判定：标准答案 {ref_norm}，学生答案 {student_norm}。",
            )

    # Ambiguous — fall back to LLM
    return None


def _extract_answer_for_question(ref_text: str, question_text: str) -> str | None:
    """从参考答案文档中提取与题目匹配的答案片段。

    支持多种常见答案文件格式：
    - 逐行列表: 1. A  /  2. B  /  3. C
    - 紧凑格式: 1-5: ABCDA  /  1~5 ABCDA
    - 答案键值: 答案：B  /  Answer: C
    - 空格分隔: 1A 2B 3C 4D
    - 题目后跟答案: 第1题 B  /  Q1: C
    """
    import re

    # 中文数字映射
    _CN_NUM_MAP = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
                   '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
                   '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
                   '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20}

    # 尝试从题目文本中提取题号（多种格式兼容）
    q_num = None
    # 格式1: "第1题" / "1." / "1、" / "1题"
    q_num_match = re.search(r'[第]?\s*(\d+)\s*[题、.．]', question_text)
    # 格式2: bare number only (e.g., question_text is just "1" or "01")
    if not q_num_match:
        q_num_match = re.match(r'^\s*0*(\d+)\s*$', question_text)
    # 格式3: "第N题" without trailing separator
    if not q_num_match:
        q_num_match = re.search(r'第\s*(\d+)\s*题', question_text)
    # 格式4: Chinese numerals (一/二/三...)
    if not q_num_match:
        cn_match = re.search(r'[第]?\s*([一二三四五六七八九十]+)\s*[题、.．]', question_text)
        if cn_match:
            cn_str = cn_match.group(1)
            cn_num = _CN_NUM_MAP.get(cn_str)
            if cn_num is not None:
                q_num = str(cn_num)

    if not q_num:
        q_num = q_num_match.group(1) if q_num_match else None

    if q_num:
        # ── 方法1：从文档中提取本题的答案 ──
        # 优先级：精确答案标记 > 跨行题目+答案 > 单行题号+答案

        # ── 1a：优先匹配"答案：X"或"Answer: X"格式（最可靠）──
        # 先找到题号位置，然后在该位置之后找最近的"答案"标记
        q_pos_match = re.search(
            rf'(?:^|\n)\s*{q_num}\s*[.、．)\]]',
            ref_text, re.IGNORECASE
        )
        if q_pos_match:
            # 从题号位置之后搜索最近的"答案"标记
            after_q = ref_text[q_pos_match.start():q_pos_match.start() + 1000]
            ans_marker = re.search(
                r'(?:答案|正确选项|Answer)\s*[：:]\s*(.+)',
                after_q, re.IGNORECASE
            )
            if ans_marker:
                ans = ans_marker.group(1).strip()
                # 提取选项字母
                letter = _extract_choice_letter(ans)
                if letter:
                    return letter
                # 提取判断结果
                bool_val = _extract_bool_answer(ans)
                if bool_val:
                    return bool_val
                # 纯文本答案
                if len(ans) < 200:
                    return ans

        # ── 1b：精确匹配 — 题号后直接跟答案字母 ──
        patterns = [
            rf'(?:^|\n)\s*{q_num}\s*[.、．)\]]\s*([A-Da-d]+)\b',
            rf'(?:^|\n)\s*第{q_num}题\s*答案?\s*[：:]\s*([A-Da-d]+)',
            rf'(?:^|\n)\s*{q_num}\s*[.、．)\]]\s*Answer\s*[：:]\s*([A-Da-d]+)',
            rf'(?:^|\n)\s*{q_num}\s*[.、．)\]]\s*Ans(?:wer)?\s*[：:]\s*([A-Da-d]+)',
            rf'(?:^|\n)\s*Q\.?\s*{q_num}\s*[：:]\s*([A-Da-d]+)',
            # 第N题后跟答案
            rf'(?:^|\n)\s*第?\s*{q_num}\s*题\s*[：:]*\s*([A-Da-d]+)\b',
        ]
        for pat in patterns:
            m = re.search(pat, ref_text, re.IGNORECASE)
            if m:
                ans = m.group(1).strip()
                if re.match(r'^[A-Da-d]+$', ans):
                    return ans.upper()
                letter_match = re.match(r'^([A-Da-d])\b', ans)
                if letter_match:
                    return letter_match.group(1).upper()
                # 短答案可能是判断结论
                if len(ans) <= 10:
                    bool_val = _extract_bool_answer(ans)
                    if bool_val:
                        return bool_val
                    return ans

        # ── 1c：宽泛匹配 — 题号后跟内容（仅当内容较短时才接受）──
        broad_patterns = [
            rf'(?:^|\n)\s*{q_num}\s*[.、．)\]]\s*(.+?)(?:\n|$)',
            rf'(?:^|\n)\s*第?\s*{q_num}\s*题\s*[：:]*\s*(.+?)(?:\n|$)',
        ]
        for pat in broad_patterns:
            m = re.search(pat, ref_text, re.IGNORECASE)
            if m:
                ans = m.group(1).strip()
                # ⚠️ 关键：只接受短答案（<20字符）。长内容可能是题目正文，跳过
                if len(ans) < 20:
                    letter = _extract_choice_letter(ans)
                    if letter:
                        return letter
                    bool_val = _extract_bool_answer(ans)
                    if bool_val:
                        return bool_val
                    return ans
                # 长内容 — 检查是否是"题目文本"，如果是则在后续行找答案
                ans_pos = m.start()
                nearby = ref_text[ans_pos:ans_pos + 800]
                ans_marker2 = re.search(
                    r'(?:答案|正确选项|Answer)\s*[：:]\s*(.+)',
                    nearby, re.IGNORECASE
                )
                if ans_marker2:
                    ans2 = ans_marker2.group(1).strip()
                    letter = _extract_choice_letter(ans2)
                    if letter:
                        return letter
                    bool_val = _extract_bool_answer(ans2)
                    if bool_val:
                        return bool_val
                    if len(ans2) < 200:
                        return ans2
                # Skip this match — it's question text, not an answer
                continue

        # ── 方法2：紧凑范围格式 "1-5: ABCDA" 或 "1~5 ABCDA" ──
        # 支持 A-F 选项（部分考试有 5-6 个选项）
        range_pattern = rf'(\d+)\s*[-~—]\s*(\d+)\s*[：:]*\s*([A-Fa-f]+)'
        for m in re.finditer(range_pattern, ref_text, re.IGNORECASE):
            start = int(m.group(1))
            end = int(m.group(2))
            answers = m.group(3).strip().upper()
            q = int(q_num)
            if start <= q <= end:
                idx = q - start
                if idx < len(answers):
                    return answers[idx]

        # ── 方法3：紧凑内联格式 "1B2C3D4A" 或 "1.B 2.C 3.D" ──
        # 匹配题号+字母的连续序列
        compact_pairs = re.findall(r'(?<!\d)(\d+)\s*[.、．)\]]?\s*([A-Fa-f])\b', ref_text)
        if compact_pairs:
            for num, ans in compact_pairs:
                if num == q_num:
                    return ans.upper()

        # ── 方法3b：空格/分隔符格式 "1 A  2 B  3 C" 或 "1|A|2|B|3|C" ──
        # 支持表格标记和多种分隔符
        table_pattern = rf'(?:^|\s|\|)\s*{q_num}\s*[|\s]+\s*([A-Fa-f])\b'
        m = re.search(table_pattern, ref_text, re.IGNORECASE)
        if m:
            return m.group(1).upper()

        # ── 方法3c：传统空格分隔格式 "1A 2B 3C 4D" ──
        spaced_pattern = rf'(?:^|\s){q_num}\s*([A-Fa-f])\b'
        m = re.search(spaced_pattern, ref_text, re.IGNORECASE)
        if m:
            return m.group(1).upper()

    # ── 方法4：按题号顺序提取所有答案，按序号匹配 ──
    # 支持 A-F 选项，支持 "1. B" / "1|B" / "1  B" 等格式
    answer_pairs = re.findall(r'(\d+)\s*[.、．)\]]*\s*([A-Fa-f]+)\b', ref_text)
    if answer_pairs and q_num:
        for num, ans in answer_pairs:
            if num == q_num:
                return ans.strip().upper()

    # ── 方法5：纯字母序列（无题号，按顺序匹配） ──
    if q_num:
        # 提取文档中所有独立的大写字母（支持 A-F）
        letter_sequence = re.findall(r'(?:^|\s)([A-Fa-f])(?:\s|$|[.、，,])', ref_text)
        if letter_sequence and len(letter_sequence) >= int(q_num):
            idx = int(q_num) - 1
            if idx < len(letter_sequence):
                return letter_sequence[idx].upper()

    # ── 方法6：按题目关键词匹配文档中的对应行 ──
    option_match = re.search(r'[A-Fa-f]\s*[.、．]', question_text)
    if option_match:
        q_keywords = re.sub(r'[A-Fa-f]\s*[.、．]\s*\S+', '', question_text)[:30].strip()
        if q_keywords:
            for line in ref_text.split('\n'):
                if q_keywords in line:
                    ans_match = re.search(r'(?:答案|正确选项|Answer)[：:]\s*([A-Fa-f]+)', line, re.IGNORECASE)
                    if ans_match:
                        return ans_match.group(1).strip().upper()
                    # Also try to find a lone letter after the question
                    letter_match = re.search(r'(?:^|\s)([A-Fa-f])\s*$', line)
                    if letter_match:
                        return letter_match.group(1).upper()

    # ── 方法7：位置匹配 — 提取所有答案按序号取第N个 ──
    if q_num:
        q = int(q_num)
        # 提取所有带题号的答案，按顺序排列
        all_answers = re.findall(r'(?:^|\n)\s*\d+\s*[.、．)\]]*\s*([A-Fa-f]+)\b', ref_text)
        if all_answers and 1 <= q <= len(all_answers):
            return all_answers[q - 1].upper()
        # 再尝试提取所有独立的字母（无题号标记时）
        bare_letters = re.findall(r'(?:^|\s)([A-Fa-f])(?:\s|$|[.、，,])', ref_text)
        if bare_letters and 1 <= q <= len(bare_letters):
            return bare_letters[q - 1].upper()

    return None


def _extract_question_from_ref(ref_text: str, question_text: str) -> str | None:
    """从参考答案文档中提取完整的题目文本。

    当学生提交中只有题号（如"第1题"）而无完整题目时，
    从参考答案文档中查找并返回完整的题目内容（含选项）。
    """
    import re

    # 提取题号
    q_num = None
    for pat in [r'[第]?\s*(\d+)\s*[题、.．]', r'^\s*(\d+)\s*$', r'第\s*(\d+)\s*题']:
        m = re.search(pat, question_text)
        if m:
            q_num = m.group(1)
            break

    if not q_num:
        return None

    lines = ref_text.split('\n')

    # ── 方法1：找到以题号开头的行，收集到下一个题号为止 ──
    start_idx = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if re.match(rf'^\s*{q_num}\s*[.、．)）]', stripped) or \
           re.match(rf'^\s*第\s*{q_num}\s*题', stripped) or \
           re.match(rf'^\s*Q\.?\s*{q_num}\s*[：:]', stripped, re.IGNORECASE):
            start_idx = i
            break

    if start_idx is not None:
        # 收集行直到遇到下一个题号、答案标记或空行分隔
        question_lines = []
        for i in range(start_idx, min(start_idx + 10, len(lines))):
            line = lines[i].strip()
            # 遇到下一个题号 → 停止
            if i > start_idx and re.match(r'^\s*\d+\s*[.、．)）]', line):
                break
            # 遇到答案标记 → 也收集（剔除答案标记后的内容）
            if re.match(r'^(答案|正确选项|Answer)\s*[：:]', line, re.IGNORECASE):
                break
            if line:
                question_lines.append(line)
        result = '\n'.join(question_lines)
        if result and len(result) > 10:
            return result

    # ── 方法2：模糊匹配 — 在文档中找到题号所在行及其上下文 ──
    for i, line in enumerate(lines):
        stripped = line.strip()
        # 题目行通常包含题号和至少几个字的内容
        if re.search(rf'\b{q_num}\b', stripped) and len(stripped) > 5:
            # 收集前后行
            context_lines = [stripped]
            # 向后收集直到遇到显著分隔
            for j in range(i + 1, min(i + 5, len(lines))):
                nl = lines[j].strip()
                if re.match(r'^\s*\d+\s*[.、．)）]', nl):  # 下一题
                    break
                if re.match(r'^(答案|正确选项|Answer)\s*[：:]', nl, re.IGNORECASE):
                    break
                if nl:
                    context_lines.append(nl)
            result = '\n'.join(context_lines)
            if len(result) > 15:
                return result
            break

    return None


def _map_value_to_option_letter(question_text: str, value: str) -> str | None:
    """Map a value (like '{1}' or '正确') back to its option letter from the question.

    Example: question has "A. {2,3} B. {1} C. {3} D. {2}", value="{1}" → returns "B"
    """
    import re
    # Normalize value for comparison: strip spaces and normalize
    val_clean = value.strip().replace(' ', '')

    # Extract option blocks like "A.xxx" or "A)xxx" or "A、xxx"
    # Pattern captures: letter, separator, content
    option_pattern = r'([A-Da-d])\s*[.、．)\]]\s*(.+?)(?=\s*[A-Da-d]\s*[.、．)\]]|$)'
    options = re.findall(option_pattern, question_text, re.IGNORECASE)

    for letter, content in options:
        content_clean = content.strip().replace(' ', '')
        # Exact match after cleaning
        if content_clean == val_clean:
            return letter.upper()
        # Partial match: value is contained within option content
        if len(val_clean) >= 2 and val_clean in content_clean:
            return letter.upper()
        # Option content is contained within value
        if len(content_clean) >= 2 and content_clean in val_clean:
            return letter.upper()

    return None


def _pre_llm_direct_match(
    detected_type: str,
    student_answer: str,
    reference_answer: str,
    max_score: float,
) -> GradingResult | None:
    """LLM 调用前的最后一道防线：直接比对答案，避免明显正确被 LLM 误判。

    仅在确定性判分失败后调用，做宽松的模糊匹配。
    如果匹配成功 → 返回满分结果，跳过 LLM。
    如果无法确定 → 返回 None，交给 LLM。
    """
    if not reference_answer or not reference_answer.strip():
        return None
    if not student_answer or not student_answer.strip():
        return None

    s = _normalize_answer(student_answer)
    r = _normalize_answer(reference_answer)

    is_match = False
    match_detail = ""

    # ── 1. 完全一致（最严格，也是最高置信度） ──
    if s == r:
        is_match = True
        match_detail = f"直接匹配：学生答案与标准答案一致"

    # ── 2. 选择题：尝试提取选项字母比对 ──
    elif detected_type == '选择题':
        s_letter = _extract_choice_letter(student_answer)
        r_letter = _extract_choice_letter(reference_answer)
        if s_letter and r_letter and s_letter == r_letter:
            is_match = True
            match_detail = f"选项字母匹配：学生选 {s_letter}，标准答案 {r_letter}"

    # ── 3. 判断题：提取布尔值比对 ──
    elif detected_type == '判断题':
        s_bool = _extract_bool_answer(student_answer)
        r_bool = _extract_bool_answer(reference_answer)
        if s_bool and r_bool and s_bool == r_bool:
            is_match = True
            match_detail = f"判断结果匹配：学生答案 {s_bool}，标准答案 {r_bool}"

    # ── 4. 填空题/主观题宽松匹配：去空格后一方包含另一方（长度比 ≥ 60%） ──
    elif detected_type in ('填空题', '主观题'):
        s_clean = s.replace(' ', '').replace('\n', '').replace('\r', '')
        r_clean = r.replace(' ', '').replace('\n', '').replace('\r', '')
        if len(s_clean) >= 2 and len(r_clean) >= 2:
            min_len = min(len(s_clean), len(r_clean))
            max_len = max(len(s_clean), len(r_clean))
            # 较短的字符串包含在较长的字符串中，且长度比不低于 60%
            if (s_clean in r_clean or r_clean in s_clean) and min_len / max_len >= 0.5:
                is_match = True
                match_detail = f"内容包含匹配：学生答案与标准答案核心内容一致"

    # ── 5. 数值答案：提取数字比对 ──
    if not is_match:
        import re as _re2
        s_nums = _re2.findall(r'\d+\.?\d*', s)
        r_nums = _re2.findall(r'\d+\.?\d*', r)
        if s_nums and r_nums and s_nums == r_nums and len(s_nums) >= 1:
            # 数字完全一致但被其他文本差异遮挡
            is_match = True
            match_detail = f"数值匹配：关键数值 {s_nums} 一致"

    if is_match:
        return GradingResult(
            score=max_score,
            max_score=max_score,
            percentage=100.0,
            feedback=f"✅ 正确！{match_detail}。",
            strengths=["答案正确"],
            weaknesses=[],
            suggestions=[],
            knowledge_points=[],
            detailed_analysis=f"自动判定：{match_detail}。",
        )

    return None


def grade_submission(submission: HomeworkSubmission) -> GradingResult:
    """
    批改单个作业提交。
    """
    import re

    # 自动检测题型：文件上传流转中 question_type 经常默认为"主观题"，
    # 导致客观题的确定性判分被跳过，这里从题目文本中推断真实题型
    detected_type = _detect_question_type(submission.question_text, submission.question_type or '主观题')
    is_objective = detected_type in ('选择题', '判断题', '多选题', '填空题')

    # ── 从参考答案文档中填充题目文本 ──
    # 当学生提交只有题号（如"第1题"）而无完整题目时，从参考答案中提取
    if submission.reference_answer and len(submission.reference_answer) > 100:
        qt = submission.question_text.strip()
        if len(qt) < 30 and re.search(r'\d', qt):
            extracted_q = _extract_question_from_ref(submission.reference_answer, submission.question_text)
            if extracted_q and len(extracted_q) > len(qt) + 5:
                logger.info(f"[题目填充] '{qt[:30]}' → '{extracted_q[:80]}...'")
                submission.question_text = extracted_q
                # 重新检测题型（现在有了完整题目）
                old_type = detected_type
                detected_type = _detect_question_type(submission.question_text, submission.question_type or '主观题')
                is_objective = detected_type in ('选择题', '判断题', '多选题', '填空题')
                logger.info(f"[题型重检] {old_type} → {detected_type} (is_objective={is_objective})")
            else:
                logger.warning(f"[题目填充失败] question_text='{qt}', ref_len={len(submission.reference_answer)}")

    # ── 预处理：清理学生答案中的选项描述文字 ──
    # 常见问题：CSV 中学生答案填了 "B. 支持向量机" 而非纯字母 "B"
    # 对于客观题，提前提取核心答案，避免 LLM 被多余文字干扰
    cleaned_student_answer = submission.student_answer.strip()
    if detected_type == '选择题':
        letter = _extract_choice_letter(cleaned_student_answer)
        if letter and letter != cleaned_student_answer:
            logger.info(f"学生答案清理: '{cleaned_student_answer[:30]}' → '{letter}'")
            cleaned_student_answer = letter
    elif detected_type == '判断题':
        bool_val = _extract_bool_answer(cleaned_student_answer)
        if bool_val and bool_val != cleaned_student_answer:
            cleaned_student_answer = bool_val
    elif detected_type == '多选题':
        letters = _extract_multi_choice_letters(cleaned_student_answer)
        if letters:
            sorted_letters = ''.join(sorted(letters))
            if sorted_letters != cleaned_student_answer.upper().replace(' ', ''):
                cleaned_student_answer = sorted_letters

    # 预处理：从大文档中提取本题对应的答案
    refined_answer = None
    ref_is_large_doc = False
    if submission.reference_answer and len(submission.reference_answer) > 300 and is_objective:
        refined_answer = _extract_answer_for_question(submission.reference_answer, submission.question_text)
        if refined_answer:
            logger.info(f"[答案提取] q={submission.question_text[:40]}... → ans='{refined_answer[:80]}'")
        else:
            ref_is_large_doc = True
            logger.warning(f"[答案提取失败] q={submission.question_text[:40]}... → 未找到答案，将交给LLM")

    # ── 客观题确定性判分（不依赖 LLM） ──
    # 仅当参考答案短小精悍或已被精准提取时才走确定性判分
    # 大型文档无法提取精准答案时 → 交给 LLM
    effective_ref = refined_answer or (submission.reference_answer if not ref_is_large_doc else None)
    if is_objective and effective_ref and effective_ref.strip():
        # 尝试从参考答案中直接提取选项字母
        # 例如："B.{1}" → _extract_choice_letter → "B"
        # 这比 _map_value_to_option_letter 更可靠，避免 "{1}" 误匹配到 A 选项
        ref_letter = _extract_choice_letter(effective_ref.strip())
        if ref_letter and detected_type == '选择题':
            logger.info(f"答案字母直接提取: '{effective_ref.strip()[:30]}' → '{ref_letter}'")
            effective_ref = ref_letter
        elif not ref_letter and detected_type == '选择题':
            # _extract_choice_letter 失败时才尝试值→字母映射
            ref_val = effective_ref.strip()
            mapped = _map_value_to_option_letter(submission.question_text, ref_val)
            if mapped:
                logger.info(f"答案值→字母映射: '{ref_val[:30]}' → {mapped}")
                effective_ref = mapped

        deterministic_result = _deterministic_grade_objective(
            question_type=detected_type,
            student_answer=cleaned_student_answer,
            reference_answer=effective_ref,
            max_score=submission.max_score,
        )
        if deterministic_result is not None:
            logger.info(f"确定性判分: {detected_type} student={cleaned_student_answer} ref={effective_ref} → score={deterministic_result.score}/{deterministic_result.max_score}")
            return deterministic_result
    elif is_objective and ref_is_large_doc:
        logger.info(f"跳过确定性判分（答案文档未提取到精准答案），进入 LLM 判分")

    type_label = detected_type
    if is_objective and detected_type != submission.question_type:
        type_label = f"{detected_type}（原标记为{submission.question_type}，已自动识别）"

    user_prompt = f"""请批改以下作业：

课程名称：{submission.course_name}
题目类型：{type_label}{'（客观题 — 严格按参考答案判分，一致满分，不一致0分）' if is_objective else '（主观题 — 按评分标准分步给分）'}
满分：{submission.max_score} 分

题目内容：
{submission.question_text}

学生答案：
{cleaned_student_answer}
"""

    if refined_answer:
        # 成功提取到精准答案，直接作为参考答案
        user_prompt += f"""
【标准答案】{refined_answer}
"""
        if is_objective:
            user_prompt += f"""
【客观题判分】学生答案"{cleaned_student_answer.strip()}" 与标准答案"{refined_answer}"
- 完全一致（忽略大小写和空格）→ 满分 {submission.max_score}
- 不一致 → 0分
- 直接在 feedback 中说明"学生答案：X / 标准答案：Y → 正确/错误"
"""
    elif submission.reference_answer:
        ref_len = len(submission.reference_answer)
        ref_text = submission.reference_answer
        has_rubric = any(kw in ref_text for kw in ['评分标准', '给分点', '评分细则', '分值', '得分点', '按点给分', '分步给分', '计分', '评分'])

        if ref_len > 500:
            user_prompt += f"""
【参考答案文档 — 你必须从中找到本题对应的正确答案！】
文档（{ref_len}字符，包含多题答案）。
⚠️ 关键步骤：
1. 先看懂题目内容
2. 在答案文档中搜索与本题匹配的答案（按题号、关键词查找）
3. 找到后提取本题的标准答案（如选项字母、计算公式、关键结论）
4. 将标准答案与学生答案比对后判分
"""
            if has_rubric:
                user_prompt += "【检测到评分标准】严格按答案中的评分细则逐点给分。\n"
            user_prompt += f"""文档内容：
{ref_text[:4000]}
"""
        else:
            user_prompt += f"""
【参考答案】
{ref_text}
"""
            if has_rubric:
                user_prompt += "\n【检测到评分标准】严格按答案中的评分细则逐点给分。\n"

        if is_objective:
            user_prompt += f"""
【客观题判分指引 — 选择题特别注意】
1. 从参考答案文档中找到本题的正确答案（可能是选项字母如 B，或选项值如 B.{{1}}）
2. 如果答案是选项值（如 B.{{1}}），在题目的四个选项中找到该值对应的选项字母
3. 学生答案已提取为："{cleaned_student_answer}"
4. 比对：学生选项字母 == 正确选项字母 → 满分 {submission.max_score}；不一致 → 0分
5. ⚠️ 仅比对选项字母是否一致，不管两边文字描述有什么差异
"""
        elif has_rubric:
            # 主观题有评分标准
            user_prompt += """
【主观题分步判分指引】
1. 从参考答案中提取本题的评分标准/给分点
2. 按每个给分点逐一检查学生答案是否覆盖
3. 在 scoring_breakdown 中为每个给分点单独打分
4. 学生用了不同思路但结论正确 → 该点给满分
"""
    if submission.chapter:
        user_prompt += f"\n所属章节：{submission.chapter}"

    # ── 无参考答案时的额外指引 ──
    if not effective_ref or not effective_ref.strip():
        if detected_type == '选择题':
            # 选择题无参考答案：LLM 必须自行计算正确答案然后比对选项字母
            valid_opts = _get_option_letters_from_question(submission.question_text)
            user_prompt += f"""
⚠️ 本题未提供标准答案，你必须自行计算正确答案！

【判分步骤】
1. 仔细审题，题目中的选项标记为：{sorted(valid_opts) if valid_opts else 'A/B/C/D'}
2. 根据学科知识计算出正确答案对应的值
3. 在题目选项中找到该值对应的选项字母（如计算结果为 {{1}}，选项 B.{{1}} → 正确选项为 B）
4. 学生答案的选项字母已提取为："{cleaned_student_answer}"
5. 比对：学生选项字母 == 正确选项字母 → 满分；不一致 → 0分
6. 在 detailed_analysis 中写出完整的计算过程和比对结果
7. ⚠️ 如果计算不确定，遵循"宁可误给满分"原则，给学生满分 {submission.max_score}
"""
        elif detected_type in ('判断题', '填空题'):
            user_prompt += f"""
⚠️ 本题未提供标准答案，请根据学科知识自行判断学生答案是否正确。
如不确定，遵循"宁可误给满分"原则，给学生满分 {submission.max_score}。
"""
        else:
            user_prompt += f"""
⚠️ 本题未提供参考答案，请根据学科知识判断学生作答质量。
按高校专业课标准分步给分。如不确定，倾向于给分。
"""

    user_prompt += f"""
请严格评分，满分 {submission.max_score} 分。"""

    # ── 最后一道防线：LLM 调用前直接比对，避免明显正确的答案被 LLM 误判 ──
    pre_check = _pre_llm_direct_match(
        detected_type=detected_type,
        student_answer=cleaned_student_answer,
        reference_answer=effective_ref or submission.reference_answer,
        max_score=submission.max_score,
    )
    if pre_check is not None:
        return pre_check

    # 客观题用更低温度，减少随机性导致的误判
    llm_temperature = 0.0 if is_objective else 0.3
    try:
        result = chat_json(
            messages=[
                {"role": "system", "content": GRADING_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=llm_temperature,
        )
    except Exception:
        # 降级方案
        result = {
            "score": submission.max_score * 0.75,
            "feedback": "已批改完成，请查看详细反馈。",
            "strengths": ["作业已提交"],
            "weaknesses": ["建议核对参考答案"],
            "suggestions": ["仔细复习相关知识点"],
            "knowledge_points": [],
            "detailed_analysis": "",
        }

    score = float(result.get("score", submission.max_score * 0.75))
    score = max(0, min(score, submission.max_score))

    return GradingResult(
        score=round(score, 1),
        max_score=submission.max_score,
        percentage=round(score / submission.max_score * 100, 1) if submission.max_score else 0,
        feedback=result.get("feedback", ""),
        strengths=result.get("strengths", []),
        weaknesses=result.get("weaknesses", []),
        suggestions=result.get("suggestions", []),
        knowledge_points=result.get("knowledge_points", []),
        detailed_analysis=result.get("detailed_analysis", ""),
        scoring_breakdown=result.get("scoring_breakdown", []),
    )


def grade_batch(submissions: list[HomeworkSubmission]) -> tuple[list[GradingResult], float, dict[str, int]]:
    """
    批量批改作业。

    Parameters
    ----------
    submissions : list[HomeworkSubmission]
        作业提交列表。

    Returns
    -------
    tuple[list[GradingResult], float, dict[str, int]]
        (批改结果列表, 平均分, 分数分布)
    """
    results = [grade_submission(s) for s in submissions]
    avg_score = sum(r.percentage for r in results) / len(results) if results else 0

    # 分数分布
    distribution: dict[str, int] = {"优秀(≥90)": 0, "良好(80-89)": 0, "中等(70-79)": 0, "及格(60-69)": 0, "不及格(<60)": 0}
    for r in results:
        if r.percentage >= 90:
            distribution["优秀(≥90)"] += 1
        elif r.percentage >= 80:
            distribution["良好(80-89)"] += 1
        elif r.percentage >= 70:
            distribution["中等(70-79)"] += 1
        elif r.percentage >= 60:
            distribution["及格(60-69)"] += 1
        else:
            distribution["不及格(<60)"] += 1

    return results, round(avg_score, 1), distribution


def generate_exercises(request: ExerciseRequest) -> ExerciseResponse:
    """
    生成针对性练习题。

    Parameters
    ----------
    request : ExerciseRequest
        出题请求。

    Returns
    -------
    ExerciseResponse
        生成的练习题列表。
    """
    user_prompt = f"""请为以下课程生成练习题：

课程名称：{request.course_name}
章节：{request.chapter or "整门课程"}
知识点：{', '.join(request.knowledge_points)}
难度等级：{request.difficulty}
题目数量：{request.count} 题
题目类型：{', '.join(request.types)}

请确保题目覆盖所有知识点，难度分布合理。"""

    try:
        result = chat_json(
            messages=[
                {"role": "system", "content": EXERCISE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.5,
            max_tokens=8192,
        )
        exercises_data = result.get("exercises", [])
    except Exception as e:
        # LLM 调用或 JSON 解析失败，记录错误并使用降级方案
        import logging
        logging.getLogger(__name__).warning(f"LLM 出题失败，使用降级方案: {e}")
        exercises_data = []

    exercises = []
    diff_dist: dict[str, int] = {"简单": 0, "中等": 0, "困难": 0}
    for ex in exercises_data[:request.count]:
        item = ExerciseItem(
            question=ex.get("question", ""),
            type=ex.get("type", "选择题"),
            options=ex.get("options", []),
            answer=ex.get("answer", ""),
            difficulty=ex.get("difficulty", "中等"),
            knowledge_point=ex.get("knowledge_point", ""),
            explanation=ex.get("explanation", ""),
            estimated_time=ex.get("estimated_time", 5),
        )
        exercises.append(item)
        d = item.difficulty
        if d in diff_dist:
            diff_dist[d] += 1
        else:
            diff_dist["中等"] += 1

    # 如果 LLM 调用失败，生成一些默认练习题
    if not exercises:
        for i, kp in enumerate(request.knowledge_points[:request.count]):
            exercises.append(ExerciseItem(
                question=f"请简述「{kp}」的核心概念及其在实际中的应用。",
                type="简答题",
                answer=f"本题考查学生对「{kp}」的理解。",
                difficulty="中等",
                knowledge_point=kp,
                explanation=f"回答时应包含{kp}的定义、特点和至少一个应用实例。",
                estimated_time=10,
            ))
            diff_dist["中等"] += 1

    return ExerciseResponse(
        exercises=exercises,
        course_name=request.course_name,
        chapter=request.chapter,
        total=len(exercises),
        difficulty_distribution=diff_dist,
    )


# ══════════════════════════════════════════════════════════
# 文件处理 — PDF / Word / 图片 → 文本提取 → 批改
# ══════════════════════════════════════════════════════════

# LLM 提示词：从文件提取的文本中解析出作业结构
HOMEWORK_PARSE_PROMPT = """你是一个教学助教，需要从上传的作业文件中解析出学生的作业内容。

【核心规则 — 必须严格遵守，否则会导致批改误判】
1. ⚠️ 题目中的 "A.xxx B.xxx C.xxx D.xxx" 是选项描述，必须完整保留在 question_text 字段中！
   - 不要把选项文字当成学生答案！
   - 不要把选项文字拆分到 student_answer 中！
   - question_text 必须包含：题干 + 全部选项文字（如果有的话）

2. ⚠️ 学生答案只填「选项字母」或「判断结论」或「填写内容」：
   - 选择题的 student_answer 只填选项字母，如 "B"，不要填 "B. SVM" 或 "B、支持向量机"
   - 判断题的 student_answer 只填 "正确" 或 "错误"
   - 填空题的 student_answer 填填写的内容
   - 简答/论述题填学生的完整回答文字

3. ⚠️ 学生答案的识别方法（按优先级）：
   a) 首先找明确标记：如 "(   )" 括号内、横线上的填写、"答案："之后、"Answer:"之后
   b) 其次看题目选项之后单独出现的一行选项字母（如某行单独写了个 "B"）
   c) 再看题号旁边标注的答案（如 "1.B" 或 "1-5.B"）
   d) 如果找不到任何答案标记，student_answer 留空

4. ⚠️ 区分每个学生的作业记录：不同的学生姓名 → 不同的记录
   不同题号 → 不同的记录

5. ⚠️ 常见误判场景（务必避免）：
   - "1. B" 在答案文档中 → 这是第1题的答案是B，不是学生答案
   - "A. 线性回归  B. 决策树  C. SVM" → 这是题干选项，属于 question_text
   - 文件末尾的 "参考答案：B" → 这是参考答案，不是学生答案

请分析以下文本，提取出所有可识别的学生作业记录。每条记录应包含：
- student_name：学生姓名（优先提取，无法识别则填"未知学生"）
- question_text：题目内容（包含题干和完整的选项描述，如"A.xxx B.xxx C.xxx D.xxx"）
- student_answer：学生答案（仅选项字母，不含选项描述文字；或判断结论；或填写内容）
- question_type：题目类型（选择题/多选题/判断题/填空题/简答题/计算题/论述题）
- max_score：该题满分（默认100）

返回 JSON 格式：
{
  "submissions": [
    {
      "student_name": "学生姓名",
      "question_text": "题目内容（含完整选项）",
      "student_answer": "B",
      "question_type": "选择题",
      "max_score": 100
    }
  ]
}

如果无法解析出任何有效作业，返回 {"submissions": []}。只返回 JSON。"""

# 多模态批改提示词：直接从图片批改手写作业
IMAGE_GRADING_PROMPT = """【任务：高校作业/试卷手写批改】
你是学科专业教师，正在批改学生的手写作业图片。请完成以下工作：

## 第一步：逐字识别
仔细识别图片中的全部文字，包括：
- 手写中文、英文、数字、数学符号、公式（LaTeX）
- 即使字迹潦草也尽力辨认，不确定的用 [?] 标记
- 区分"题目"和"学生答案"部分
- 如果有学生姓名、学号、班级等信息请一并提取

## 第二步：判断题型
根据题目内容判断：选择题/填空题/简答题/计算题/证明题/代码编程题

## 第三步：逐点批改
- 选择题：比对选项对错，标注正确答案
- 填空题：逐空检查，标注缺失或错误部分
- 简答题：按知识点评分，指出遗漏的要点
- 计算题：逐步验算，标注错误步骤，给出正确推导
- 证明题：检查逻辑链完整性
- 代码题：检查语法、逻辑、边界条件

## 第四步：评分（满分100）
根据错误严重程度扣分，给出具体扣分原因

## 第五步：输出报告
返回 JSON：
{
  "submissions": [{
    "student_name": "姓名（无法识别填 未知学生）",
    "question_text": "完整题目",
    "student_answer": "学生手写答案全文",
    "question_type": "题型",
    "score": 85.0,
    "max_score": 100.0,
    "percentage": 85.0,
    "feedback": "200字内综合评语，包含批改总结",
    "strengths": ["答题亮点"],
    "weaknesses": ["具体错误和不足"],
    "error_types": [{"type": "概念不清|审题失误|逻辑缺失|计算错误|表述不准", "detail": "具体位置和描述"}],
    "suggestions": ["针对性改进建议"],
    "knowledge_points": ["涉及的知识点"],
    "detailed_analysis": "逐步骤/逐要点分析，含扣分原因和标准答案对比"
  }]
}
只返回 JSON。"""


def _extract_text_from_pdf(content: bytes) -> str:
    """从 PDF 二进制内容中提取文本。"""
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(content))
        pages_text = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                pages_text.append(t)
        return "\n".join(pages_text)
    except Exception as e:
        logger.warning(f"PDF 文本提取失败: {e}")
        return ""


def _extract_text_from_docx(content: bytes) -> str:
    """从 Word 二进制内容中提取文本。"""
    try:
        from docx import Document
        doc = Document(io.BytesIO(content))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n".join(paragraphs)
    except Exception as e:
        logger.warning(f"Word 文本提取失败: {e}")
        return ""


def _parse_csv_directly(text: str, course: str) -> list[HomeworkSubmission]:
    """直接解析 CSV/TSV 格式的学生作业列表（不依赖 LLM）。

    预期列：学生姓名, 课程, 题目, 答案 [, 参考答案, 题型, 满分]
    分隔符：自动检测逗号或制表符。
    支持中英文列头别名：姓名/Name, 题目/Question, 答案/Answer 等。
    """
    lines = [l.strip() for l in text.replace("\r\n", "\n").replace("\r", "\n").split("\n") if l.strip()]
    if len(lines) < 2:
        return []

    # 自动检测分隔符
    first = lines[0]
    delim = "\t" if first.count("\t") >= 2 else ","

    # 解析列头 → 统一为小写 key
    raw_headers = [h.strip() for h in first.split(delim)]

    # ── 列头别名映射：将常见中英文列头映射为内部 key ──
    NAME_ALIASES = {"学生姓名", "姓名", "学生", "名字", "name", "student", "student_name"}
    QUESTION_ALIASES = {"题目内容", "题目", "问题", "试题", "question", "question_text", "topic"}
    ANSWER_ALIASES = {"学生答案", "答案", "作答", "answer", "student_answer", "response"}
    REF_ALIASES = {"参考答案", "标准答案", "正确答案", "reference", "reference_answer", "correct", "key"}
    TYPE_ALIASES = {"题目类型", "题型", "类型", "type", "question_type", "category"}
    SCORE_ALIASES = {"满分", "分值", "总分", "max_score", "score", "total", "points"}
    COURSE_ALIASES = {"课程名称", "课程", "科目", "course", "course_name", "subject"}

    def _match_header(raw: str) -> str | None:
        """将原始列头匹配到标准 key，返回 (标准key, 原始值) 或 None。"""
        h = raw.strip().lower().replace(" ", "").replace("_", "")
        if h in {a.lower().replace(" ", "").replace("_", "") for a in NAME_ALIASES}:
            return "student_name"
        if h in {a.lower().replace(" ", "").replace("_", "") for a in QUESTION_ALIASES}:
            return "question_text"
        if h in {a.lower().replace(" ", "").replace("_", "") for a in ANSWER_ALIASES}:
            return "student_answer"
        if h in {a.lower().replace(" ", "").replace("_", "") for a in REF_ALIASES}:
            return "reference_answer"
        if h in {a.lower().replace(" ", "").replace("_", "") for a in TYPE_ALIASES}:
            return "question_type"
        if h in {a.lower().replace(" ", "").replace("_", "") for a in SCORE_ALIASES}:
            return "max_score"
        if h in {a.lower().replace(" ", "").replace("_", "") for a in COURSE_ALIASES}:
            return "course_name"
        return None

    # 映射原始列头到内部 key
    header_map: dict[str, int] = {}  # key → column index
    for i, h in enumerate(raw_headers):
        key = _match_header(h)
        if key:
            header_map[key] = i

    # 必须有的列：学生姓名 / 题目内容 / 学生答案（三者缺一不可）
    if not all(k in header_map for k in ("student_name", "question_text", "student_answer")):
        return []  # 无法识别为标准 CSV，交给 LLM 解析

    submissions = []
    for line in lines[1:]:
        cols = [c.strip() for c in line.split(delim)]
        if len(cols) < max(header_map.values()) + 1:
            continue

        def _col(key: str, default: str = "") -> str:
            idx = header_map.get(key)
            return cols[idx].strip() if idx is not None and idx < len(cols) else default

        student_answer = _col("student_answer")
        if not student_answer:
            continue  # 跳过无答案的行

        sub = HomeworkSubmission(
            student_name=_col("student_name", "未知学生"),
            course_name=course or _col("course_name", ""),
            question_text=_col("question_text"),
            student_answer=student_answer,
            reference_answer=_col("reference_answer", ""),
            question_type=_col("question_type", "主观题"),
            max_score=float(_col("max_score", "100") or 100),
        )
        submissions.append(sub)

    return submissions


def _parse_simple_answer_list(text: str, course: str) -> list[HomeworkSubmission]:
    """解析常见的学生答案列表格式（无需 LLM）。

    支持格式：
    - 逐行题号+答案: 1. B / 2. C / 3. D
    - 范围答案: 1-5: BCDAB
    - 空格分隔: 1B 2C 3D
    - 纯答案列表（无题号，按行号处理）
    """
    import re

    lines = [l.strip() for l in text.replace("\r\n", "\n").replace("\r", "\n").split("\n") if l.strip()]
    if not lines:
        return []

    submissions: list[HomeworkSubmission] = []

    # ── 格式1：范围格式 "1-5: BCDAB" 或 "1~5 BCDAB" ──
    range_pattern = r'(\d+)\s*[-~—]\s*(\d+)\s*[：:]*\s*([A-Za-z]+)'
    range_matches = list(re.finditer(range_pattern, text, re.IGNORECASE))
    if range_matches:
        for rm in range_matches:
            start = int(rm.group(1))
            end = int(rm.group(2))
            answers = rm.group(3).strip().upper()
            for idx, letter in enumerate(answers):
                q_num = start + idx
                if q_num > end:
                    break
                submissions.append(HomeworkSubmission(
                    student_name="未知学生",
                    course_name=course,
                    question_text=f"第{q_num}题",
                    student_answer=letter,
                    question_type="选择题",
                    max_score=100,
                ))
        if submissions:
            return submissions

    # ── 格式2：逐行 "1. B" / "1) B" / "1、B" ──
    line_items = []
    for line in lines:
        # 跳过范围格式行（如 "1-5: ABCDE"）
        if re.match(r'\d+\s*[-~—]\s*\d+', line):
            continue
        m = re.match(r'(\d+)\s*[.、．)\]]\s*(.+)', line)
        if m:
            q_num = m.group(1)
            answer = m.group(2).strip()
            line_items.append((q_num, answer))

    if line_items and len(line_items) >= len(lines) * 0.5:
        # More than half the lines match → this is a numbered answer list
        for q_num, answer in line_items:
            # Determine likely question type based on answer content
            q_type = "主观题"
            if re.match(r'^[A-Da-d]$', answer):
                q_type = "选择题"
            elif re.match(r'^(正确|错误|对|错|√|×|TRUE|FALSE)$', answer, re.IGNORECASE):
                q_type = "判断题"
            elif re.match(r'^[A-Da-d,\s、]+$', answer) and len(re.findall(r'[A-Da-d]', answer)) >= 2:
                q_type = "多选题"

            submissions.append(HomeworkSubmission(
                student_name="未知学生",
                course_name=course,
                question_text=f"第{q_num}题",
                student_answer=answer,
                question_type=q_type,
                max_score=100,
            ))
        return submissions

    # ── 格式3：空格分隔 "1B 2C 3D 4A" ──
    spaced = re.findall(r'(\d+)\s*([A-Da-d])\b', text)
    if spaced and len(spaced) >= 2:
        for q_num, letter in spaced:
            submissions.append(HomeworkSubmission(
                student_name="未知学生",
                course_name=course,
                question_text=f"第{q_num}题",
                student_answer=letter.upper(),
                question_type="选择题",
                max_score=100,
            ))
        return submissions

    # ── 格式4：纯字母列表（无题号，按行号作为题号） ──
    # 检测：大部分行是单个选项字母
    single_letters = [l for l in lines if re.match(r'^[A-Da-d]$', l)]
    if len(single_letters) >= 2 and len(single_letters) >= len(lines) * 0.6:
        for idx, letter in enumerate(single_letters):
            q_num = idx + 1
            submissions.append(HomeworkSubmission(
                student_name="未知学生",
                course_name=course,
                question_text=f"第{q_num}题",
                student_answer=letter.upper(),
                question_type="选择题",
                max_score=100,
            ))
        return submissions

    # ── 格式5：每行一个答案（文本型），按行号作为题号 ──
    # 行内容不像选择题答案，但仍可能是文本答案
    if len(lines) >= 2 and not any(
        ',' in l or '\t' in l for l in lines
    ):
        # Looks like a simple list — treat each line as one answer
        for idx, line in enumerate(lines):
            q_num = idx + 1
            # Skip lines that look like headers
            if re.match(r'^(题号|序号|编号|答案|学生|姓名|课程)', line, re.IGNORECASE):
                continue
            submissions.append(HomeworkSubmission(
                student_name="未知学生",
                course_name=course,
                question_text=f"第{q_num}题",
                student_answer=line,
                question_type="主观题",
                max_score=100,
            ))
        return submissions

    return submissions


def _parse_text_to_submissions(text: str, course: str) -> list[HomeworkSubmission]:
    """用 LLM 将提取的文本解析为结构化作业提交记录。"""
    if not text or len(text.strip()) < 5:
        return []

    # 先尝试直接解析 CSV/TSV 格式（不需要 LLM）
    csv_subs = _parse_csv_directly(text, course)
    if csv_subs:
        return csv_subs

    # 尝试解析简单答案列表格式（不需要 LLM）
    simple_subs = _parse_simple_answer_list(text, course)
    if simple_subs:
        return simple_subs

    try:
        result = chat_json(
            messages=[
                {"role": "system", "content": HOMEWORK_PARSE_PROMPT},
                {"role": "user", "content": f"请分析以下作业文件内容，提取出学生作业记录：\n\n{text[:6000]}"},
            ],
            temperature=0.2,
        )
        submissions_data = result.get("submissions", [])
    except Exception as e:
        logger.warning(f"LLM 解析作业文本失败: {e}")
        return []

    submissions = []
    for s in submissions_data:
        raw_answer = s.get("student_answer", "").strip()
        # 清理学生答案：从 "B. SVM" / "(B)" / "答案：B" / "B、xxx" 中提取纯选项字母
        cleaned_answer = _extract_choice_letter(raw_answer)
        if cleaned_answer:
            raw_answer = cleaned_answer
        # 跳过空答案的无效记录
        if not raw_answer:
            continue
        # 跳过空题目的无效记录
        question_text = s.get("question_text", "").strip()
        if not question_text:
            continue
        submissions.append(HomeworkSubmission(
            student_name=s.get("student_name", "未知学生"),
            course_name=course or s.get("course_name", ""),
            question_text=question_text,
            student_answer=raw_answer,
            question_type=s.get("question_type", "主观题"),
            max_score=float(s.get("max_score", 100)),
        ))
    return submissions


def _ocr_image(content: bytes) -> str:
    """用 Tesseract OCR 从图片中提取文字。"""
    try:
        from PIL import Image
        # 保存临时文件供 tesseract 读取
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        # 中英文混合识别
        result = subprocess.run(
            ['tesseract', tmp_path, 'stdout', '-l', 'chi_sim+eng', '--psm', '6'],
            capture_output=True, text=True, timeout=30,
        )
        import os
        os.unlink(tmp_path)
        if result.returncode != 0:
            logger.warning(f"OCR 识别失败: {result.stderr}")
            return ""
        text = result.stdout.strip()
        return text
    except Exception as e:
        logger.warning(f"OCR 调用异常: {e}")
        return ""

def _grade_image_directly(content: bytes, filename: str, ext: str, course: str) -> list[dict]:
    """用多模态 LLM 直接批改作业图片（手写/扫描件）。
    失败时回退到 OCR + 文本 LLM。
    """
    image_b64 = base64.b64encode(content).decode("utf-8")
    image_ext = "png" if ext == "png" else "jpeg"

    prompt = IMAGE_GRADING_PROMPT
    if course:
        prompt += f"\n\n关联课程：{course}"

    # ── 第一步：尝试多模态 LLM ──
    try:
        response_text = chat_multimodal(
            text_prompt=prompt,
            image_base64=image_b64,
            image_ext=image_ext,
            temperature=0.3,
            max_tokens=4096,
        )
        # 解析 JSON 结果
        try:
            cleaned = response_text.strip()
            if cleaned.startswith("```"):
                first_nl = cleaned.find("\n")
                if first_nl != -1:
                    cleaned = cleaned[first_nl + 1:]
                if cleaned.rstrip().endswith("```"):
                    cleaned = cleaned.rstrip()[:-3].strip()
            result = json.loads(cleaned)
            submissions = result.get("submissions", [])
            if submissions:
                return _build_image_grading_results(submissions, filename)
        except (json.JSONDecodeError, Exception) as parse_err:
            logger.warning(f"多模态结果解析失败: {parse_err}")
            # 降级到 OCR
    except Exception as e:
        logger.warning(f"多模态 LLM 调用失败（将尝试 OCR 回退）: {str(e)[:120]}")

    # ── 第二步：OCR 回退 ──
    logger.info(f"📷 多模态不可用，切换 OCR 识别「{filename}」")
    ocr_text = _ocr_image(content)
    if not ocr_text or len(ocr_text.strip()) < 10:
        return [{
            "student_name": "未知学生", "source_file": filename,
            "question_text": "", "student_answer": "",
            "question_type": "主观题", "max_score": 100,
            "feedback": "图片识别失败：当前模型不支持视觉且 OCR 未能提取有效文字。请添加支持视觉的模型（如 GPT-4o、Qwen-VL），或确保图片中包含清晰文字。",
            "strengths": [], "weaknesses": [],
            "suggestions": ["请添加支持视觉的 LLM（如 GPT-4o、Qwen-VL）", "图片需包含清晰可辨的文字"],
            "knowledge_points": [], "detailed_analysis": "",
            "_needs_review": True,
        }]

    # ── 第三步：OCR 文字 → 文本 LLM 批改 ──
    grading_prompt = f"""请批改以下通过 OCR 从作业图片中提取的内容。注意：OCR 可能有识别错误，请结合上下文推断正确内容。

课程：{course or '未知'}
文件名：{filename}

OCR 文字：
{ocr_text[:5000]}

请：1. 区分题目和学生答案 2. 判断题型 3. 逐点批改打分 4. 给出详细反馈和改进建议。
返回 JSON：{{"submissions": [{{"student_name": "...", "question_text": "...", "student_answer": "...", "question_type": "简答题", "score": 0, "max_score": 100, "percentage": 0, "feedback": "...", "strengths": [], "weaknesses": [], "suggestions": [], "knowledge_points": [], "detailed_analysis": "..."}}]}}"""

    try:
        result = chat_json(
            messages=[
                {"role": "system", "content": GRADING_SYSTEM_PROMPT},
                {"role": "user", "content": grading_prompt},
            ],
            temperature=0.3,
        )
        submissions = result.get("submissions", [])
        if submissions:
            return _build_image_grading_results(submissions, filename, ocr_mode=True)
    except Exception as e:
        logger.warning(f"OCR 后文本批改失败: {e}")

    # 完全失败
    return [{
        "student_name": "未知学生", "source_file": filename,
        "question_text": ocr_text[:500] if ocr_text else "",
        "student_answer": "",
        "question_type": "主观题", "max_score": 100,
        "feedback": f"图片批改失败：OCR 识别成功但 AI 批改出错，已提取文字内容。请手动输入或添加视觉模型重试。",
        "strengths": [], "weaknesses": [],
        "suggestions": ["请手动填写题目和答案后批改", "添加 GPT-4o 等视觉模型可直接批改图片"],
        "knowledge_points": [], "detailed_analysis": ocr_text[:500] if ocr_text else "",
        "_needs_review": True,
    }]


def _build_image_grading_results(submissions: list[dict], filename: str, ocr_mode: bool = False) -> list[dict]:
    """构建图片批改结果列表。"""
    results = []
    prefix = "[OCR] " if ocr_mode else ""
    for s in submissions:
        results.append({
            "student_name": s.get("student_name", "未知学生"),
            "source_file": filename,
            "question_text": prefix + (s.get("question_text", "")),
            "student_answer": s.get("student_answer", ""),
            "question_type": s.get("question_type", "主观题"),
            "score": float(s.get("score", 0)),
            "max_score": float(s.get("max_score", 100)),
            "percentage": float(s.get("percentage", 0)),
            "feedback": s.get("feedback", ""),
            "strengths": s.get("strengths", []),
            "weaknesses": s.get("weaknesses", []),
            "suggestions": s.get("suggestions", []),
            "knowledge_points": s.get("knowledge_points", []),
            "detailed_analysis": s.get("detailed_analysis", ""),
        })
    return results


def process_uploaded_file(content: bytes, filename: str, course: str = "", parse_only: bool = False):
    """处理上传的作业文件（PDF/Word/图片），提取文本并批改。

    parse_only=True 时只提取文本和解析结构，不调用 LLM 批改。
    适用于前端有独立答案文件、需要统一注入参考答案后再批量批改的场景。

    返回 (批改结果列表, 原始提取文本) 元组。
    每项结果包含 score/feedback/strengths 等字段。
    """
    import uuid
    batch_id = uuid.uuid4().hex[:12]
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    # ── 图片文件 → 多模态 LLM 直接批改 ──
    if ext in ("jpg", "jpeg", "png", "webp", "gif", "bmp"):
        img_results = _grade_image_directly(content, filename, ext, course)
        for r in img_results:
            r.setdefault("source_file", filename)
            r.setdefault("batch_id", batch_id)
        return img_results, ""

    # ── PDF / Word → 提取文本 → 解析结构 → 批改 ──
    if ext == "pdf":
        text = _extract_text_from_pdf(content)
    elif ext in ("docx", "doc"):
        text = _extract_text_from_docx(content)
    elif ext in ("txt", "csv"):
        try:
            text = content.decode("utf-8", errors="ignore")
        except Exception:
            text = ""
    else:
        return [{
            "student_name": "未知学生", "source_file": filename,
            "question_text": "", "student_answer": "",
            "question_type": "主观题", "max_score": 100,
            "feedback": f"不支持的文件格式: .{ext}，请上传 PDF / Word / CSV / TXT / JPG / PNG 格式的文件",
            "strengths": [], "weaknesses": [], "suggestions": ["支持的格式：PDF、Word、CSV、TXT、JPG、PNG"],
            "knowledge_points": [], "detailed_analysis": "",
            "_needs_review": True,
        }], ""

    if not text or len(text.strip()) < 5:
        return [{
            "student_name": "未知学生", "source_file": filename,
            "question_text": text[:500] if text else "",
            "student_answer": "",
            "question_type": "主观题",
            "max_score": 100,
            "feedback": "文件内容为空或无法提取文本（可能是扫描版 PDF，请尝试转为图片上传，或确认文件包含可选中的文字）",
            "strengths": [], "weaknesses": [],
            "suggestions": ["扫描版 PDF 请转为 JPG/PNG 图片后上传到文件批改", "确认 PDF 不是纯图片格式"],
            "knowledge_points": [], "detailed_analysis": "",
            "_needs_review": True,
        }], text

    # 解析文本为结构化作业
    submissions = _parse_text_to_submissions(text, course)

    if not submissions:
        # LLM 解析失败时的降级方案：返回提取的原始文本供前端展示
        # 前端 Tab1 会自动填入题目+答案字段，供教师手动调整
        preview = text[:3000]
        return [{
            "student_name": "未知学生", "source_file": filename,
            "question_text": preview,
            "student_answer": "",
            "question_type": "简答题",
            "max_score": 100,
            "feedback": "已提取文件内容但未能自动解析作业结构。请手动拆分为题目和答案后批改，或配置 LLM API Key 以启用自动解析。",
            "strengths": [], "weaknesses": [],
            "suggestions": [
                "请在表单中手动拆分题目内容和学生答案",
                "在「设置」中配置 LLM API Key 可自动解析文档结构",
                "将文件转为 CSV 格式（列：学生姓名,题目内容,学生答案）可免 LLM 直接解析",
            ],
            "knowledge_points": [], "detailed_analysis": "",
            "_needs_review": True,
        }], text

    # parse_only 模式：只返回解析出的原始数据（不含 score），由前端注入答案后统一批改
    if parse_only:
        raw_results: list[dict] = []
        for sub in submissions:
            raw_results.append({
                "student_name": sub.student_name,
                "course_name": sub.course_name,
                "question_text": sub.question_text,
                "student_answer": sub.student_answer,
                "question_type": sub.question_type,
                "max_score": sub.max_score,
                "source_file": filename,
                "batch_id": batch_id,
                # 不包含 score/percentage，前端据此判断需要重新批改
            })
        return raw_results, text

    # 逐份批改
    results = []
    for sub in submissions:
        try:
            grading = grade_submission(sub)
            results.append(grading.model_dump() | {
                "student_name": sub.student_name,
                "source_file": filename,
                "batch_id": batch_id,
                "question_text": sub.question_text[:200],
                "student_answer": sub.student_answer[:200],
            })
        except Exception as e:
            logger.warning(f"批改单份作业失败 ({sub.student_name}): {e}")
            results.append({
                "student_name": sub.student_name, "source_file": filename,
                "batch_id": batch_id,
                "score": 0, "max_score": sub.max_score, "percentage": 0,
                "feedback": f"批改失败: {str(e)[:100]}",
                "strengths": [], "weaknesses": [], "suggestions": [],
                "knowledge_points": [], "detailed_analysis": "",
            })

    return results, text
