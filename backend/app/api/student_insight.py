"""
学情洞察 API — 学情分析和预警的 RESTful 接口。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.models.database import InsightReport, get_db
from app.models.schemas import (
    APIResponse,
    ClassInsightRequest,
    ClassInsightResponse,
    StudentInsightRequest,
    StudentInsightResponse,
)
from app.services.student_service import analyze_class, analyze_student

router = APIRouter(prefix="/api/insight", tags=["学情洞察"])


@router.post("/student", response_model=APIResponse)
async def analyze_student_api(request: StudentInsightRequest):
    """
    分析学生个体学情。

    基于学生的成绩记录和作业数据，分析知识掌握度、
    薄弱环节、学习趋势，并给出个性化学习建议和预警。
    """
    try:
        result = analyze_student(request)
        return APIResponse(
            success=True,
            message="学情分析完成",
            data=result.model_dump(),
        )
    except Exception as e:
        err_msg = str(e)
        if "401" in err_msg or "auth" in err_msg.lower() or "credential" in err_msg.lower():
            raise HTTPException(status_code=500, detail="LLM API Key 无效或已过期，请前往「LLM API 配置」页面更新密钥")
        if "connection" in err_msg.lower() or "timeout" in err_msg.lower():
            raise HTTPException(status_code=500, detail="LLM 服务连接失败，请检查网络或 API 地址配置")
        raise HTTPException(status_code=500, detail=f"学情分析失败：{err_msg[:100]}")


@router.post("/class", response_model=APIResponse)
async def analyze_class_api(request: ClassInsightRequest):
    """
    分析班级整体学情。

    汇总全班学生的学情数据，分析班级整体水平、
    分数分布、共性薄弱环节，生成重点关注名单。
    """
    try:
        result = analyze_class(request)
        return APIResponse(
            success=True,
            message="班级学情分析完成",
            data=result.model_dump(),
        )
    except Exception as e:
        err_msg = str(e)
        if "401" in err_msg or "auth" in err_msg.lower() or "credential" in err_msg.lower():
            raise HTTPException(status_code=500, detail="LLM API Key 无效或已过期，请前往「LLM API 配置」页面更新密钥")
        if "connection" in err_msg.lower() or "timeout" in err_msg.lower():
            raise HTTPException(status_code=500, detail="LLM 服务连接失败，请检查网络或 API 地址配置")
        raise HTTPException(status_code=500, detail=f"班级学情分析失败：{err_msg[:100]}")


@router.get("/reports", response_model=APIResponse)
async def list_reports(db: Session = Depends(get_db)):
    """获取所有已保存的学情分析报告列表。"""
    reports = db.query(InsightReport).order_by(InsightReport.created_at.desc()).limit(100).all()
    items = [r.to_dict() for r in reports]
    return APIResponse(success=True, data={"reports": items, "total": len(items)})


@router.delete("/reports/{report_id}", response_model=APIResponse)
async def delete_report(report_id: str, db: Session = Depends(get_db)):
    """删除单条学情报告。"""
    record = db.query(InsightReport).filter(InsightReport.id == report_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    db.delete(record)
    db.commit()
    return APIResponse(success=True, message="学情报告已删除")
