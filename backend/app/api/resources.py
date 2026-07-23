"""
资源下载 API — 后端生成有效的 .docx / .pptx 文件并返回二进制流。
"""

from __future__ import annotations

import io
import zipfile
from urllib.parse import quote

from fastapi import APIRouter, Request
from fastapi.responses import Response

router = APIRouter(prefix="/api/resources", tags=["资源下载"])


def _build_docx(title: str, body: str) -> bytes:
    """生成最小有效 .docx 文件（Office Open XML 格式）。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        zf.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '</Types>',
        )
        zf.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>',
        )
        zf.writestr(
            "word/_rels/document.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
        )
        # ── 字体定义（支持中文 + Unicode 数学符号） ──
        FONT_BODY = '<w:rFonts w:eastAsia="SimSun" w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
        FONT_TITLE = '<w:rFonts w:eastAsia="SimHei" w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
        LINE_SPACING = '<w:spacing w:line="360" w:lineRule="auto"/>'  # 1.5 倍行距

        def _escape_xml(text: str) -> str:
            """转义 XML 特殊字符，保留 Unicode 数学符号。"""
            if not text:
                return ""
            return (str(text)
                    .replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
                    .replace('"', "&quot;")
                    .replace("'", "&apos;"))

        def _make_para(content: str, font: str = FONT_BODY, size: int = 24,
                        bold: bool = False, align: str = "", indent: int = 0) -> str:
            """构建格式化段落（左对齐，首行缩进可选）。"""
            bold_xml = '<w:b/>' if bold else ''
            align_xml = f'<w:jc w:val="{align}"/>' if align else ''
            indent_xml = f'<w:ind w:firstLine="{indent}"/>' if indent else ''
            return (f'<w:p><w:pPr>{align_xml}{indent_xml}{LINE_SPACING}</w:pPr>'
                    f'<w:r><w:rPr>{font}{bold_xml}<w:sz w:val="{size}"/></w:rPr>'
                    f'<w:t xml:space="preserve">{_escape_xml(content)}</w:t></w:r></w:p>')

        paragraphs = []
        # 标题
        paragraphs.append(_make_para(title, font=FONT_TITLE, size=32, bold=True, align="center"))
        paragraphs.append(_make_para("", size=14))  # 空行

        for line in body.split("\n"):
            stripped = line.strip()
            if not stripped:
                paragraphs.append(_make_para("", size=14))
                continue
            # 题型标题行（以数字序号或【开头）
            if (stripped[0].isdigit() and ". " in stripped[:4]) or stripped.startswith("【"):
                paragraphs.append(_make_para(stripped, font=FONT_TITLE, size=24, bold=True))
            # 答案/解析/知识点行（缩进显示）
            elif stripped.startswith("答案：") or stripped.startswith("解析：") or stripped.startswith("知识点："):
                paragraphs.append(_make_para(stripped, size=22, indent=480))
            # 选项行
            elif stripped.startswith("   ") or stripped.startswith("  "):
                paragraphs.append(_make_para(stripped, size=22, indent=480))
            else:
                paragraphs.append(_make_para(stripped, size=24))

        zf.writestr(
            "word/document.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
            ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<w:body>'
            f'{"".join(paragraphs)}'
            '<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            '<w:pgSz w:w="11906" w:h="16838"/>'
            '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>'
            '</w:sectPr>'
            '</w:body></w:document>',
        )
    return buf.getvalue()


def _build_pptx(title: str, body: str) -> bytes:
    """生成最小有效 .pptx 文件。"""
    lines = [l for l in body.split("\n") if l.strip()]
    slides_xml_parts = []
    for i, line in enumerate(lines):
        escaped = line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        slides_xml_parts.append(
            '<p:sld>'
            '<p:cSld><p:spTree>'
            '<p:sp><p:nvSpPr><p:cNvPr id="1" name="Text"/><p:cNvSpPr><a:spLocks noGrp="1"/>'
            '</p:cNvSpPr><p:nvPr/></p:nvSpPr>'
            '<p:spPr><a:xfrm><a:off x="914400" y="457200"/>'
            '<a:ext cx="8229600" cy="914400"/></a:xfrm></p:spPr>'
            '<p:txBody><a:bodyPr/><a:lstStyle/>'
            '<a:p><a:r><a:rPr lang="zh-CN" sz="2400" b="1"/>'
            f'<a:t>{escaped}</a:t></a:r></a:p>'
            '</p:txBody></p:sp>'
            '</p:spTree></p:cSld>'
            '</p:sld>'
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        zf.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
            '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
            '</Types>',
        )
        zf.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>'
            '</Relationships>',
        )
        zf.writestr(
            "ppt/_rels/presentation.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>'
            '</Relationships>',
        )
        zf.writestr(
            "ppt/presentation.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
            '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>'
            '</p:presentation>',
        )
        zf.writestr(
            "ppt/slides/slide1.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
            ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
            ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<p:cSld><p:spTree>'
            f'{"".join(slides_xml_parts)}'
            '</p:spTree></p:cSld>'
            '</p:sld>',
        )
    return buf.getvalue()


@router.get("/download/{filename}")
async def download_resource(filename: str, content: str = ""):
    """下载教学资源文件。根据扩展名动态生成有效的 Office 文档。"""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    base_name = filename.rsplit(".", 1)[0] if "." in filename else filename

    if not content:
        content = (
            "═══════════════════════════════════════\n"
            "  学科助教系统 Edu-TA — 演示文档\n"
            "═══════════════════════════════════════\n\n"
            f"文件名：{filename}\n"
            "所属项目：挑战杯 · 学科垂类大模型赛道\n\n"
            "此文件由后端 Python zipfile 生成，\n"
            "符合 Office Open XML 标准。\n"
            "═══════════════════════════════════════"
        )

    if ext == "docx":
        file_data = _build_docx(title=base_name, body=content)
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif ext == "pptx":
        file_data = _build_pptx(title=base_name, body=content)
        media_type = "application/vnd.openxmlformats-officedocument.presentationml.document"
    else:
        # PDF / ZIP 等其余格式：纯文本 + .txt 后缀，确保能打开
        file_data = content.encode("utf-8")
        media_type = "text/plain; charset=utf-8"
        filename = filename + ".txt"

    encoded_filename = quote(filename, safe="")
    return Response(
        content=file_data,
        media_type=media_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
            "Content-Length": str(len(file_data)),
        },
    )


# ── 通用 Word 导出（POST） ────────────────────────────────

@router.post("/export-word")
async def export_word(request: Request):
    """通用 Word 导出接口 — 接受 title + content 文本，返回 .docx 文件。"""
    data = await request.json()
    title = data.get("title", "导出文档")
    content = data.get("content", "")
    filename = data.get("filename", f"{title}.docx")

    if not filename.endswith(".docx"):
        filename += ".docx"

    file_data = _build_docx(title=title, body=content)
    encoded_filename = quote(filename, safe="")
    return Response(
        content=file_data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
            "Content-Length": str(len(file_data)),
        },
    )
