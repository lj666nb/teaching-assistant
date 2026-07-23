"""
智能备课 API — 教案生成、管理与导出的 RESTful 接口（数据库持久化版）。
"""

from __future__ import annotations

import io
import json
import uuid
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.models.database import LessonPlan, get_db
from app.models.schemas import APIResponse, LessonPlanListResponse, LessonPlanRequest, LessonPlanResponse
from app.services.lesson_service import generate_lesson_plan as generate_plan_service
from app.api.audit import log_operation, save_snapshot

router = APIRouter(prefix="/api/lesson", tags=["智能备课"])


@router.post("/generate", response_model=APIResponse)
async def generate_plan(request: LessonPlanRequest, db: Session = Depends(get_db)):
    """生成教案并保存到数据库。

    教案生成（LLM 调用）与数据库保存解耦：
    - LLM 调用成功 → 立即返回教案给前端
    - 数据库保存失败 → 自动重试，仍返回教案（降级为不持久化）
    """
    # 第一步：生成教案（核心逻辑，不能跳过）
    plan = generate_plan_service(request)
    plan_dict = plan.model_dump()

    # 第二步：尝试保存到数据库（自动重试，但不阻塞返回）
    import time as _time
    save_error = None
    for attempt in range(3):
        try:
            lesson = LessonPlan(
                id=plan.id,
                course_name=request.course_name,
                chapter=request.chapter,
                total_hours=request.teaching_hours,
                additional_requirements=request.additional_requirements,
                plan_data=json.dumps(plan_dict, ensure_ascii=False),
                created_at=datetime.now(),
                updated_at=datetime.now(),
            )
            db.add(lesson)
            db.commit()

            # 审计日志 + 版本快照
            log_operation(db, plan.id, "create", operator="教师", operator_role="教师",
                          course_name=request.course_name, chapter=request.chapter,
                          detail=f"AI 生成教案：{request.course_name} — {request.chapter}（{request.teaching_hours}课时）")
            save_snapshot(db, plan.id, plan_dict, created_by="AI系统")
            save_error = None
            break
        except Exception as e:
            save_error = str(e)
            db.rollback()
            if attempt < 2:
                _time.sleep(1.0 * (attempt + 1))  # 递增等待：1s, 2s

    if save_error:
        import logging
        logging.getLogger(__name__).warning(f"教案 {plan.id} 数据库保存失败（已重试3次）: {save_error}")

    return APIResponse(
        success=True,
        message="教案生成成功" if not save_error else "教案已生成（暂未保存到台账，请稍后重试）",
        data=plan_dict,
    )


@router.get("/plans", response_model=APIResponse)
async def list_plans(course: str = "", db: Session = Depends(get_db)):
    """获取所有已生成的教案列表（按时间倒序）。

    返回的每条记录会将 plan_data 展开到顶层，
    确保 sessions / objectives / methods / resources 等字段可直接访问。
    """
    query = db.query(LessonPlan)
    if course:
        query = query.filter(LessonPlan.course_name == course)
    plans = query.order_by(LessonPlan.created_at.desc()).all()

    items = []
    for p in plans:
        raw = p.to_dict()
        pd = raw.pop("plan_data", {}) or {}
        # 将 plan_data 的内容展开到顶层
        item = {
            "id": p.id,
            "course_name": p.course_name,
            "chapter": p.chapter,
            "total_hours": p.total_hours,
            "created_at": raw.get("created_at", ""),
            "objectives": pd.get("objectives", []),
            "methods": pd.get("methods", []),
            "resources": pd.get("resources", []),
            "sessions": pd.get("sessions", []),
            "board_design": pd.get("board_design", {}),
            "class_tasks": pd.get("class_tasks", []),
            "homework": pd.get("homework", []),
            "assessment": pd.get("assessment", {}),
            "innovation": pd.get("innovation", {}),
        }
        items.append(item)

    return APIResponse(success=True, data={"plans": items, "total": len(items)})


@router.get("/plans/{plan_id}", response_model=APIResponse)
async def get_plan(plan_id: str, db: Session = Depends(get_db)):
    """获取指定教案的详细信息。"""
    plan = db.query(LessonPlan).filter(LessonPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="教案不存在")
    log_operation(db, plan_id, "view", operator="教师", course_name=plan.course_name, chapter=plan.chapter,
                  detail=f"查看教案详情：{plan.course_name} — {plan.chapter}")
    return APIResponse(success=True, data=plan.to_dict())


@router.put("/plans/{plan_id}", response_model=APIResponse)
async def update_plan(plan_id: str, request: Request, db: Session = Depends(get_db)):
    """编辑已生成的教案（支持教师人工修改）。"""
    plan = db.query(LessonPlan).filter(LessonPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="教案不存在")
    body = await request.json()
    new_data = body.get("plan_data", body)

    # 更新基本字段
    if "course_name" in new_data:
        old_course = plan.course_name
        plan.course_name = new_data["course_name"]
    if "chapter" in new_data:
        plan.chapter = new_data["chapter"]
    if "total_hours" in new_data and new_data["total_hours"] is not None:
        plan.total_hours = int(new_data["total_hours"]) or plan.total_hours or 2

    # 更新 plan_data（整个教案结构化数据）
    old_plan_data = json.loads(plan.plan_data) if plan.plan_data else {}
    updated_plan_data = {**old_plan_data, **new_data}
    plan.plan_data = json.dumps(updated_plan_data, ensure_ascii=False)
    plan.updated_at = datetime.now()
    db.commit()

    # 审计日志 + 版本快照
    changes_before = {k: old_plan_data.get(k) for k in new_data if k in old_plan_data}
    log_operation(db, plan_id, "edit", operator="教师",
                  course_name=plan.course_name, chapter=plan.chapter,
                  detail=f"编辑教案：{plan.course_name} — {plan.chapter}",
                  changes_before=changes_before,
                  changes_after={k: new_data.get(k) for k in new_data})
    save_snapshot(db, plan_id, updated_plan_data, created_by="教师")

    return APIResponse(success=True, message="教案已更新", data={"plan_id": plan_id})


@router.delete("/plans/{plan_id}", response_model=APIResponse)
async def delete_plan(plan_id: str, db: Session = Depends(get_db)):
    """删除指定教案。"""
    plan = db.query(LessonPlan).filter(LessonPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="教案不存在")
    log_operation(db, plan_id, "delete", operator="教师",
                  course_name=plan.course_name, chapter=plan.chapter,
                  detail=f"删除教案：{plan.course_name} — {plan.chapter}")
    db.delete(plan)
    db.commit()
    return APIResponse(success=True, message="教案已删除")


@router.get("/courses", response_model=APIResponse)
async def list_courses(db: Session = Depends(get_db)):
    """获取有教案记录的所有课程列表。"""
    rows = db.query(LessonPlan.course_name).distinct().all()
    courses = [r[0] for r in rows if r[0]]
    return APIResponse(success=True, data={"courses": courses})


# ══════════════════════════════════════════════════════════
# 共享 Word 模板引擎（A4 · 1.5 倍行距 · 首行缩进）
# ══════════════════════════════════════════════════════════

# ── 字体常量 ──
FONT_H = '<w:rFonts w:eastAsia="SimHei" w:ascii="Calibri" w:hAnsi="Calibri"/>'   # 黑体（标题）
FONT_B = '<w:rFonts w:eastAsia="SimSun" w:ascii="Calibri" w:hAnsi="Calibri"/>'    # 宋体（正文）
LINE_15 = 360  # 1.5 倍行距
INDENT_2 = 480  # 首行缩进 2 字符
COLOR_BLUE  = '<w:color w:val="1F4E79"/>'
COLOR_RED   = '<w:color w:val="C00000"/>'
COLOR_GREEN = '<w:color w:val="2E7D32"/>'
COLOR_GRAY  = '<w:color w:val="666666"/>'
COLOR_BG_BLUE  = '<w:shd w:val="clear" w:color="auto" w:fill="E8F0FE"/>'
COLOR_BG_RED   = '<w:shd w:val="clear" w:color="auto" w:fill="FDECEC"/>'
COLOR_BG_GREEN = '<w:shd w:val="clear" w:color="auto" w:fill="E8F5E9"/>'
COLOR_BG_ORANGE = '<w:shd w:val="clear" w:color="auto" w:fill="FFF3E0"/>'

A4_SECTION = '<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>'

# ── 工具函数 ──
def _esc(text: str) -> str:
    """XML 转义，保留 Unicode 数学符号和中文。"""
    if not text: return ""
    # 先移除 XML 不允许的控制字符（保留常用空白）
    import re
    cleaned = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F]', '', str(text))
    return cleaned.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;")

def _P(attrs: str = "", text: str = "", font: str = FONT_B, size: int = 22, indent: int = 0) -> str:
    """段落：首行缩进 indent twips，1.5 倍行距"""
    ind = f'<w:ind w:firstLine="{indent}"/>' if indent else ""
    return f'<w:p><w:pPr>{ind}<w:spacing w:line="{LINE_15}" w:lineRule="auto"/></w:pPr><w:r><w:rPr>{font}<w:sz w:val="{size}"/></w:rPr><w:t xml:space="preserve">{_esc(text)}</w:t></w:r></w:p>'

def _H(level: int, text: str) -> str:
    """标题：h1=一级居中, h2=二级左对齐, h3=三级左对齐"""
    sizes = {1: 36, 2: 28, 3: 24}
    spacings = {1: '<w:spacing w:before="360" w:after="200"/>', 2: '<w:spacing w:before="280" w:after="160"/>', 3: '<w:spacing w:before="200" w:after="120"/>'}
    align = '<w:jc w:val="center"/>' if level == 1 else ""
    return f'<w:p><w:pPr>{align}{spacings[level]}</w:pPr><w:r><w:rPr>{FONT_H}<w:b/><w:sz w:val="{sizes[level]}"/></w:rPr><w:t xml:space="preserve">{_esc(text)}</w:t></w:r></w:p>'

def _BULLET(text: str, indent: int = 480) -> str:
    """项目符号 ●"""
    return f'<w:p><w:pPr><w:ind w:left="{indent}" w:hanging="240"/><w:spacing w:line="300" w:lineRule="auto"/></w:pPr><w:r><w:rPr>{FONT_B}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">● {_esc(text)}</w:t></w:r></w:p>'

def _NUM(num_str: str, text: str, indent: int = 480) -> str:
    """编号列表"""
    return f'<w:p><w:pPr><w:ind w:left="{indent}" w:hanging="240"/><w:spacing w:line="300" w:lineRule="auto"/></w:pPr><w:r><w:rPr>{FONT_B}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">{num_str}. {_esc(text)}</w:t></w:r></w:p>'

def _BOX(text: str, bg: str = COLOR_BG_BLUE, border_color: str = "1F4E79", label: str = "") -> str:
    """分块框：带背景色和左边框的区域块"""
    border = f'<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="{border_color}"/></w:pBdr>'
    label_xml = f'<w:r><w:rPr>{FONT_H}<w:b/><w:sz w:val="22"/><w:color w:val="{border_color}"/></w:rPr><w:t xml:space="preserve">{label}</w:t></w:r>' if label else ""
    return f'<w:p><w:pPr><w:ind w:left="240"/>{border}{bg}<w:spacing w:line="320" w:lineRule="auto"/></w:pPr>{label_xml}<w:r><w:rPr>{FONT_B}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve"> {_esc(text)}</w:t></w:r></w:p>'

def _HR() -> str:
    """分隔线"""
    return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>'

def _build_zip(paragraphs: list[str]) -> bytes:
    """将段落列表打包为 .docx 文件"""
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        zf.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        zf.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        zf.writestr("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')
        doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + "".join(paragraphs) + A4_SECTION + '</w:body></w:document>'
        zf.writestr("word/document.xml", doc)
    return buf.getvalue()

# ── 方法/资源字典 ──
METHOD_DETAIL = {
    "讲授法": "以教师口头语言传授知识为主，配合板书、课件等辅助手段。适用于概念性、理论性内容的系统讲解。建议时长不超过课堂的60%。",
    "案例教学法": "通过真实或模拟的案例引导学生分析、讨论，培养问题解决能力。案例应具有典型性、争议性和启发性。",
    "讨论法": "围绕特定主题组织学生分组讨论或全班辩论，教师引导总结。适用于开放性问题和批判性思维培养。",
    "演示法": "通过实物、模型、实验或多媒体展示教学内容，直观呈现知识。适用于实验课、操作技能教学。",
    "练习法": "学生在教师指导下反复练习以巩固知识、形成技能。设计时应注重从易到难、从模仿到创新的梯度。",
    "探究法": "教师提出问题或任务，学生自主探究发现答案。适用于培养科学思维和研究能力。",
    "翻转课堂": "课前学生自学视频/资料，课上进行深度讨论和实践。适用于高年级课程。",
    "小组合作": "4-6人小组协作完成任务，培养团队协作和沟通能力。需明确分工和评价标准。",
    "项目式学习": "以项目为载体，学生在完成项目的过程中学习和应用知识。适用于综合性、实践性较强的课程。",
    "问题驱动教学": "以问题为起点，引导学生通过解决问题来学习新知识。适用于培养学生的问题解决和自主学习能力。",
}
RESOURCE_DETAIL = {
    "教材": "课程指定教材，是教学内容的核心依据。使用时应标注具体章节和页码。",
    "多媒体课件": "演示文稿等多媒体课件，用于辅助课堂讲解。建议每页不超过7行文字，图文并茂。",
    "在线学习平台": "如超星学习通、中国大学慕课等，用于发布课程资源、在线测试和讨论。",
    "板书": "传统黑板或白板书写，适合公式推导和重点强调。需提前规划布局。",
    "实验设备": "实验室仪器、开发板、传感器等硬件设备，用于实验演示和学生实操。",
    "视频资料": "教学相关视频片段，如科普纪录片、学术讲座录像等。建议每段不超过5分钟。",
    "代码示例": "完整的可运行程序代码，用于编程课程演示。建议包含详细注释。",
    "数据集": "用于实践练习的真实或模拟数据集。需说明数据来源和预处理方法。",
    "文献资料": "相关学术论文、技术报告、行业标准等，用于拓展阅读。建议标注必读/选读。",
    "教学模型": "三维模型、实体教具等，用于直观展示抽象概念。适用于工程类、医学类课程。",
}


# ── 完整教案导出 ──────────────────────────────────────

def _build_lesson_docx(plan: dict) -> bytes:
    """生成完整教案 Word 文档（A4 · 1.5倍行距 · 首行缩进 · 分块区分）。"""
    p: list[str] = []
    course_name = _esc(plan.get("course_name", ""))
    chapter = _esc(plan.get("chapter", ""))
    total_hours = plan.get("total_hours", 2)
    plan_id = _esc(plan.get("id", ""))

    # ── 封面/标题区 ──
    p.append(_H(1, "教　案"))
    p.append(_H(1, f"{course_name} — {chapter}"))
    p.append(_P(text=f"课时安排：共 {total_hours} 课时（{total_hours * 45} 分钟）"))
    p.append(_P(text=f"教案 ID：{plan_id}　|　生成时间：{plan.get('created_at','-')[:19]}"))
    p.append(_HR())

    # ── 一、教学目标 ──
    p.append(_H(2, "一、教学目标"))
    for obj in plan.get("objectives", []):
        dim = _esc(obj.get("dimension", "") if isinstance(obj, dict) else "")
        ct = _esc(obj.get("content", "") if isinstance(obj, dict) else str(obj))
        p.append(_BOX(f"【{dim}】{ct}", bg=COLOR_BG_BLUE, border_color="1F4E79", label=""))
    p.append(_P(text=""))

    # ── 二、教学方法 ──
    methods = plan.get("methods", [])
    if methods:
        p.append(_H(2, "二、教学方法"))
        for m in methods:
            detail = METHOD_DETAIL.get(m, m)
            p.append(_BULLET(f"{_esc(m)}：{_esc(detail)}"))
        p.append(_P(text=""))

    # ── 三、教学资源 ──
    resources = plan.get("resources", [])
    if resources:
        p.append(_H(2, "三、教学资源与工具"))
        for r in resources:
            detail = RESOURCE_DETAIL.get(r, r)
            p.append(_BULLET(f"{_esc(r)}：{_esc(detail)}"))
        p.append(_P(text=""))

    # ── 四、教学流程（核心） ──
    sessions = plan.get("sessions", [])
    if sessions:
        p.append(_H(2, "四、教学流程"))
        for s in sessions:
            order = s.get("session_order", 1)
            topic = _esc(s.get("session_topic", f"第{order}课时"))
            p.append(_H(3, f"第{order}课时：{topic}"))

            # 教学重点 — 橙色块
            kps = s.get("key_points", [])
            if kps:
                for kp in kps:
                    p.append(_BOX(f"📌 教学重点：{_esc(kp)}", bg=COLOR_BG_ORANGE, border_color="E65100"))
            # 教学难点 — 红色块
            dps = s.get("difficult_points", [])
            if dps:
                for dp in dps:
                    p.append(_BOX(f"⚠️ 教学难点：{_esc(dp)}", bg=COLOR_BG_RED, border_color="C00000"))

            # 教学活动 — 蓝色块分组
            acts = s.get("activities", [])
            for idx, act in enumerate(acts):
                dur = act.get("duration", 10) if isinstance(act, dict) else 10
                atype = _esc(act.get("activity_type", "")) if isinstance(act, dict) else ""
                content = _esc(act.get("content", "")) if isinstance(act, dict) else _esc(str(act))
                teacher = _esc(act.get("teacher_activity", "")) if isinstance(act, dict) else ""
                student = _esc(act.get("student_activity", "")) if isinstance(act, dict) else ""
                example = _esc(act.get("example", act.get("case", ""))) if isinstance(act, dict) else ""

                p.append(_P(text=f"⏱ 活动{idx+1}：{dur}分钟 [{atype}]", font=FONT_H, size=24))
                if content:
                    p.append(_P(text=content))
                if teacher:
                    p.append(_BOX(teacher, bg=COLOR_BG_BLUE, border_color="1F4E79", label="🎤 教师讲解："))
                if student:
                    p.append(_BOX(student, bg=COLOR_BG_GREEN, border_color="2E7D32", label="💬 师生互动："))
                if example:
                    p.append(_BOX(example, bg=COLOR_BG_ORANGE, border_color="E65100", label="📝 教学示例："))
                p.append(_P(text=""))

            hw = s.get("homework", "")
            if hw:
                p.append(_BOX(f"📝 课后作业：{_esc(hw)}", bg=COLOR_BG_BLUE, border_color="1F4E79"))
            p.append(_P(text=""))

    # ── 英文字段名 → 中文标签映射 ──
    KEY_CN = {
        "evaluation_standards": "评分标准", "rubric": "评价量规", "criteria": "评价指标",
        "level": "等级", "score": "分值", "description": "描述", "standard": "标准",
        "frontier_cases": "学科前沿案例", "research_integration": "科研反哺教学",
        "ideological_political": "课程思政融入点", "structure": "板书布局",
        "key_formulas": "关键公式与图表", "content": "内容", "source": "出处",
        "answer_hint": "解答提示", "name": "名称", "weight": "权重",
        "excellent": "优秀", "good": "良好", "pass": "及格", "fail": "不及格",
    }

    # ── 将任意值转为纯中文可读文本 ──
    def _to_text(val) -> str:
        if isinstance(val, str):
            return val
        if isinstance(val, list):
            items = []
            for v in val:
                if isinstance(v, dict):
                    parts = []
                    for dk, dv in v.items():
                        label = KEY_CN.get(dk, dk)
                        parts.append(f"{label}：{_to_text(dv)}")
                    items.append("；".join(parts))
                else:
                    items.append(str(v))
            return "\n".join(f"（{i+1}）{t}" for i, t in enumerate(items))
        if isinstance(val, dict):
            parts = []
            for dk, dv in val.items():
                label = KEY_CN.get(dk, dk)
                parts.append(f"{label}：{_to_text(dv)}")
            return "；".join(parts)
        return str(val)

    # ── 五~九、辅助模块 ──
    for idx, (title, key, is_dict) in enumerate([
        ("五、板书设计", "board_design", True),
        ("六、分层课堂任务", "class_tasks", False),
        ("七、分层课后作业", "homework", False),
        ("八、考核与评价", "assessment", True),
        ("九、教学创新设计", "innovation", True),
    ], start=5):
        data = plan.get(key)
        if not data: continue
        p.append(_H(2, title))
        if is_dict and isinstance(data, dict):
            for k, v in data.items():
                label = KEY_CN.get(k, k)
                text = _to_text(v)
                if isinstance(v, str):
                    for line in text.split("\n"):
                        if line.strip():
                            p.append(_P(text=_esc(line.strip()), indent=INDENT_2))
                else:
                    p.append(_BULLET(f"{_esc(label)}：{_esc(text)}"))
        elif isinstance(data, list):
            for i, item in enumerate(data):
                if isinstance(item, dict):
                    level = _esc(item.get("level", ""))
                    content = _to_text(item.get("content", ""))
                    src = _esc(str(item.get("source", item.get("answer_hint", ""))))
                    extra = f"　【{KEY_CN.get('answer_hint', '提示')}：{src}】" if src else ""
                    p.append(_NUM(str(i+1), f"[{level}] {content}{extra}"))
                else:
                    p.append(_BULLET(_esc(str(item))))
        p.append(_P(text=""))

    # ── 页脚 ──
    p.append(_HR())
    p.append(_P(text="本教案由智教星人工智能助教生成 · 内容仅供教学参考，请教师审核后使用。"))

    return _build_zip(p)


# ── 单流程导出（同一套模板） ──────────────────────────────

def _build_segment_docx(session: dict, course_name: str, chapter: str) -> bytes:
    """生成单流程 Word 文档（与完整教案使用同一套规范模板）。"""
    p: list[str] = []
    order = session.get("session_order", 1)
    topic = _esc(session.get("session_topic", f"第{order}课时"))

    # 标题
    p.append(_H(1, f"教案 — {_esc(course_name)}"))
    p.append(_H(1, f"第{order}课时：{topic}"))
    p.append(_P(text=f"所属章节：{_esc(chapter)}"))
    p.append(_HR())

    # 重点难点
    kps = session.get("key_points", [])
    if kps:
        for kp in kps:
            p.append(_BOX(f"📌 教学重点：{_esc(kp)}", bg=COLOR_BG_ORANGE, border_color="E65100"))
    dps = session.get("difficult_points", [])
    if dps:
        for dp in dps:
            p.append(_BOX(f"⚠️ 教学难点：{_esc(dp)}", bg=COLOR_BG_RED, border_color="C00000"))
    if kps or dps:
        p.append(_P(text=""))

    # 活动详情（同一套分块模板）
    acts = session.get("activities", [])
    for idx, act in enumerate(acts):
        dur = act.get("duration", 10) if isinstance(act, dict) else 10
        atype = _esc(act.get("activity_type", "")) if isinstance(act, dict) else ""
        content = _esc(act.get("content", "")) if isinstance(act, dict) else _esc(str(act))
        teacher = _esc(act.get("teacher_activity", "")) if isinstance(act, dict) else ""
        student = _esc(act.get("student_activity", "")) if isinstance(act, dict) else ""
        example = _esc(act.get("example", act.get("case", ""))) if isinstance(act, dict) else ""

        p.append(_P(text=f"⏱ 活动{idx+1}：{dur}分钟 [{atype}]", font=FONT_H, size=24))
        if content:
            p.append(_P(text=content))
        if teacher:
            p.append(_BOX(teacher, bg=COLOR_BG_BLUE, border_color="1F4E79", label="🎤 教师讲解："))
        if student:
            p.append(_BOX(student, bg=COLOR_BG_GREEN, border_color="2E7D32", label="💬 师生互动："))
        if example:
            p.append(_BOX(example, bg=COLOR_BG_ORANGE, border_color="E65100", label="📝 教学示例："))
        p.append(_P(text=""))

    hw = session.get("homework", "")
    if hw:
        p.append(_BOX(f"📝 课后作业：{_esc(hw)}", bg=COLOR_BG_BLUE, border_color="1F4E79"))

    p.append(_HR())
    p.append(_P(text="本教案由智教星人工智能助教生成 · 内容仅供教学参考。"))

    return _build_zip(p)


@router.post("/export-word")
async def export_lesson_word(request: Request):
    """导出完整教案为 Word 文档。"""
    body = await request.json()
    plan = body.get("plan", body)
    course_name = plan.get("course_name", "教案")
    chapter = plan.get("chapter", "")

    # 记录导出日志
    plan_id = plan.get("id", "")
    if plan_id:
        try:
            from app.models.database import SessionLocal
            _db = SessionLocal()
            log_operation(_db, plan_id, "export", operator="教师",
                          course_name=course_name, chapter=chapter,
                          detail=f"导出完整教案 Word：{course_name} — {chapter}")
            _db.close()
        except Exception:
            pass  # 日志失败不影响导出

    file_data = _build_lesson_docx(plan)
    filename = f"教案_{course_name}_{chapter}.docx"
    encoded = quote(filename, safe="")

    return Response(
        content=file_data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded}",
            "Content-Length": str(len(file_data)),
        },
    )


@router.post("/export-segment-word")
async def export_segment_word(request: Request):
    """导出单个教学流程为 Word 文档（与完整教案使用同一套 A4 规范模板）。"""
    body = await request.json()
    session = body.get("session", {})
    course_name = body.get("course_name", "教案")
    chapter = body.get("chapter", "")

    file_data = _build_segment_docx(session, course_name, chapter)
    filename = f"教案_{course_name}_第{session.get('session_order',1)}课时.docx"
    encoded = quote(filename, safe="")

    return Response(
        content=file_data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded}",
            "Content-Length": str(len(file_data)),
        },
    )
