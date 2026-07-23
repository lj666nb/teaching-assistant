"""
RAG 检索增强生成服务 — 将知识库检索与 LLM 生成结合。

核心流程：
  用户查询 → 语义检索知识库 → 构建增强提示 → LLM 生成 → 返回结果
"""

from __future__ import annotations

from typing import Any

from app.core.llm import chat_with_prompt
from app.services.knowledge_base import search as kb_search


def generate_with_rag(
    query: str,
    system_prompt: str,
    course: str = "default",
    top_k: int = 5,
    temperature: float = 0.3,
    json_mode: bool = False,
) -> str | dict:
    """
    使用 RAG 增强生成。

    Parameters
    ----------
    query : str
        用户查询。
    system_prompt : str
        系统提示词。
    course : str
        关联课程（用于知识库检索）。
    top_k : int
        检索文档数量。
    temperature : float
        生成温度。
    json_mode : bool
        是否返回 JSON。

    Returns
    -------
    str | dict
        生成结果。
    """
    # 1. 检索相关知识
    context_chunks = kb_search(query, course=course, top_k=top_k)
    context = "\n\n".join(
        f"[来源: {c.source}] {c.content}" for c in context_chunks
    )

    # 2. 构建 RAG 增强提示
    rag_prompt = f"""请基于以下参考资料回答问题。

参考资料：
{context if context else "（当前未检索到相关参考文档，请基于自身知识回答）"}

用户问题：{query}

要求：
- 优先使用参考资料中的信息，并在回答末尾标注引用来源。
- 如果参考资料不足以回答问题，请如实说明并基于自身知识补充。
- 回答应专业、准确、条理清晰，适合教学场景使用。"""

    # 3. 调用 LLM
    return chat_with_prompt(
        system_prompt=system_prompt,
        user_prompt=rag_prompt,
        temperature=temperature,
        json_mode=json_mode,
    )


def generate_rag_context(
    query: str,
    course: str = "default",
    top_k: int = 5,
) -> tuple[str, list[dict[str, Any]]]:
    """
    仅检索并返回上下文（不调用 LLM 生成）。

    Returns
    -------
    tuple[str, list[dict]]
        (格式化的上下文文本, 原始文档块列表)
    """
    chunks = kb_search(query, course=course, top_k=top_k)
    context = "\n\n".join(
        f"[{i+1}] {c.content}" for i, c in enumerate(chunks)
    )
    sources = [
        {"source": c.source, "content": c.content[:200], "score": c.score}
        for c in chunks
    ]
    return context, sources
