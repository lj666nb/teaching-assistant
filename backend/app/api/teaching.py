"""
AI 教学辅助 API — 重难点分析 / 课件优化 / 试题改编 / 课堂辅助。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.schemas import APIResponse
from app.services.teaching_service import (
    analyze_difficult_points,
    generate_variants,
    generate_classroom_materials,
    optimize_ppt,
)

router = APIRouter(prefix="/api/teaching", tags=["AI教学辅助"])


@router.post("/difficulty-analysis", response_model=APIResponse)
async def api_difficulty_analysis(data: dict):
    """场景2：分析章节重难点，输出教学突破方案。"""
    course = data.get("course", "")
    chapter = data.get("chapter", "")
    if not course or not chapter:
        raise HTTPException(status_code=400, detail="请提供课程名称和章节名称")
    try:
        result = analyze_difficult_points(course, chapter)
        return APIResponse(success=True, data=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-variants", response_model=APIResponse)
async def api_generate_variants(data: dict):
    """场景5：试题变式改编，多维度扩充题库。"""
    question = data.get("question", "")
    if not question:
        raise HTTPException(status_code=400, detail="请提供原始题目")
    try:
        result = generate_variants(
            original_question=question,
            original_answer=data.get("answer", ""),
            course=data.get("course", ""),
            chapter=data.get("chapter", ""),
        )
        return APIResponse(success=True, data=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/classroom-materials", response_model=APIResponse)
async def api_classroom_materials(data: dict):
    """场景8：生成课堂互动教学素材。"""
    course = data.get("course", "")
    chapter = data.get("chapter", "")
    if not course or not chapter:
        raise HTTPException(status_code=400, detail="请提供课程名称和章节名称")
    try:
        result = generate_classroom_materials(course, chapter)
        return APIResponse(success=True, data=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/optimize-ppt", response_model=APIResponse)
async def api_optimize_ppt(data: dict):
    """场景3：优化课件PPT内容。"""
    content = data.get("content", "")
    if not content:
        raise HTTPException(status_code=400, detail="请提供课件内容")
    try:
        result = optimize_ppt(
            ppt_content=content,
            course=data.get("course", ""),
            chapter=data.get("chapter", ""),
        )
        return APIResponse(success=True, data=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
