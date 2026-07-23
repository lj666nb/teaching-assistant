"""
知识库服务 — 基于轻量向量存储的学科向量知识库。

功能：
- 文档导入与分块
- 向量化存储
- 语义检索（RAG 底层）
- 知识库管理
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

from app.config import settings
from app.core.embeddings import get_embedding, embed_batch
from app.core.vector_store import PersistentClient, Collection
from app.models.schemas import DocumentChunk, KnowledgeBaseStatus

# ── 向量存储客户端单例（避免多 worker 并发创建 SQLite 连接导致锁竞争）──
_client: PersistentClient | None = None


def _get_client() -> PersistentClient:
    """获取向量存储客户端（持久化模式，模块级单例）。"""
    global _client
    if _client is not None:
        return _client
    _client = PersistentClient(path=settings.vector_db_path)
    return _client


def _safe_collection_name(course_name: str) -> str:
    """将课程名转为 ASCII 安全的集合名（处理中文等非 ASCII 字符）。"""
    safe = course_name.replace(" ", "_").replace("/", "_")
    # 如果包含非 ASCII 字符，使用 hash 后缀确保名称安全
    if any(ord(c) > 127 for c in safe):
        h = hashlib.md5(course_name.encode("utf-8")).hexdigest()[:8]
        # 保留原名的 ASCII 部分 + hash
        ascii_part = "".join(c for c in safe if ord(c) < 128).strip("_")
        if ascii_part:
            return f"{ascii_part}_{h}"
        return f"kb_{h}"
    return safe


def _get_collection(course_name: str = "default") -> Collection | None:
    """获取已有集合（只读操作，不自动创建）。"""
    client = _get_client()
    safe_name = _safe_collection_name(course_name)
    try:
        return client.get_collection(safe_name)
    except Exception:
        return None


def _get_or_create_collection(course_name: str = "default") -> Collection:
    """获取或创建集合（仅用于写入操作）。"""
    client = _get_client()
    safe_name = _safe_collection_name(course_name)
    return client.get_or_create_collection(
        name=safe_name,
        metadata={"hnsw:space": "cosine", "course_name": course_name},
    )


def _chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """
    将文本切分为重叠的块。

    Parameters
    ----------
    text : str
        原始文本。
    chunk_size : int
        每块最大字符数。
    overlap : int
        相邻块重叠字符数。

    Returns
    -------
    list[str]
        文本块列表。
    """
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        if chunk:
            chunks.append(chunk)
        start = end - overlap
        if start >= len(text):
            break
    return chunks if chunks else [text]


def add_document(
    content: str,
    metadata: dict[str, Any] | None = None,
    source: str = "",
    course: str = "default",
    chunk_size: int = 500,
) -> int:
    """
    将文档添加到知识库。

    Parameters
    ----------
    content : str
        文档内容。
    metadata : dict, optional
        文档元数据。
    source : str
        文档来源（文件名/URL）。
    course : str
        所属课程。
    chunk_size : int
        分块大小。

    Returns
    -------
    int
        添加的文本块数量。
    """
    collection = _get_or_create_collection(course)
    metadata = metadata or {}  # add_document

    # 标记来源：所有通过知识库 API 导入的文件均标记为 knowledge_base
    if "_source" not in metadata:
        metadata["_source"] = "knowledge_base"

    chunks = _chunk_text(content, chunk_size=chunk_size)
    ids = []
    documents = []
    metadatas = []

    for i, chunk in enumerate(chunks):
        unique_id = hashlib.md5(f"{source}:{i}:{chunk[:50]}".encode()).hexdigest()
        ids.append(unique_id)
        documents.append(chunk)
        metadatas.append({
            **metadata,
            "source": source,
            "course": course,
            "chunk_index": i,
            "total_chunks": len(chunks),
        })

    # 使用项目 embedding 服务预计算向量
    embeddings = embed_batch(chunks)

    collection.add(
        documents=documents,
        embeddings=embeddings,
        metadatas=metadatas,
        ids=ids,
    )
    return len(chunks)


def add_textbook(
    file_path: str,
    course: str,
    chapter: str = "",
) -> int:
    """
    添加教材文件到知识库（支持 PDF/TXT/DOCX）。

    Parameters
    ----------
    file_path : str
        文件路径。
    course : str
        课程名称。
    chapter : str
        章节名称。

    Returns
    -------
    int
        添加的文本块数量。
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"文件不存在: {file_path}")

    # 读取文件
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(str(path))
        content = "\n".join((page.extract_text() or "") for page in reader.pages)
        # 清理 PDF 中可能存在的非法代理字符
        content = content.encode("utf-8", errors="replace").decode("utf-8")
    elif suffix in (".docx", ".doc"):
        try:
            from docx import Document
            doc = Document(str(path))
            content = "\n".join(p.text for p in doc.paragraphs)
        except Exception:
            raise RuntimeError("无法解析 .doc 文件，请转换为 .docx 格式后重试")
    else:
        content = path.read_text(encoding="utf-8")

    file_size = path.stat().st_size
    from datetime import datetime, timezone
    upload_time = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")

    result = add_document(
        content=content,
        metadata={"chapter": chapter, "filename": path.name},
        source=path.name,
        course=course,
    )

    # 更新集合元数据：记录文件大小和上传时间
    collection = _get_collection(course)
    if collection:
        meta = dict(collection.metadata or {})
        # 追加文件大小和上传时间（多个文件上传时累加大小）
        meta["total_size"] = (meta.get("total_size", 0) + file_size)
        meta["uploaded_at"] = upload_time
        meta["file_count"] = meta.get("file_count", 0) + 1
        client = _get_client()
        client.get_or_create_collection(_safe_collection_name(course), metadata=meta)

    return result


def search(
    query: str,
    course: str = "default",
    top_k: int = 5,
    filter_criteria: dict[str, Any] | None = None,
) -> list[DocumentChunk]:
    """
    语义检索知识库。

    Parameters
    ----------
    query : str
        查询内容。
    course : str
        课程名称。
    top_k : int
        返回结果数量。
    filter_criteria : dict, optional
        过滤条件。

    Returns
    -------
    list[DocumentChunk]
        检索结果。
    """
    try:
        collection = _get_collection(course)
        if collection is None:
            return []
    except Exception:
        return []

    query_vector = get_embedding(query)
    where = filter_criteria if filter_criteria else None

    results = collection.query(
        query_embeddings=[query_vector],
        n_results=min(top_k, 20),
        where=where,
    )

    chunks = []
    if results["documents"] and results["documents"][0]:
        for i, doc in enumerate(results["documents"][0]):
            meta = (results["metadatas"][0][i]) if results["metadatas"] else {}
            dist = (results["distances"][0][i]) if results["distances"] else 0
            score = max(0, 1 - dist)  # 余弦距离转相似度
            chunks.append(DocumentChunk(
                id=results["ids"][0][i] if results["ids"] else "",
                content=doc,
                metadata=meta,
                source=meta.get("source", ""),
                score=round(score, 4),
            ))
    return chunks


def get_status() -> KnowledgeBaseStatus:
    """获取知识库状态信息。"""
    try:
        client = _get_client()
        collections = client.list_collections()
        total_chunks = 0
        total_size = 0
        last_updated = ""
        courses = []
        for col in collections:
            total_chunks += col.count()
            courses.append(col.name)
            meta = col.metadata or {}
            total_size += meta.get("total_size", 0)
            uploaded = meta.get("uploaded_at", "")
            if uploaded and uploaded > last_updated:
                last_updated = uploaded

        # 格式化存储大小
        if total_size <= 0:
            storage_str = "—"
        elif total_size < 1024:
            storage_str = f"{total_size} B"
        elif total_size < 1048576:
            storage_str = f"{total_size / 1024:.1f} KB"
        else:
            storage_str = f"{total_size / 1048576:.1f} MB"

        return KnowledgeBaseStatus(
            total_chunks=total_chunks,
            total_documents=len(collections),
            courses=courses,
            last_updated=last_updated,
            vector_db_path=settings.vector_db_path,
            storage=storage_str,
        )
    except Exception as e:
        return KnowledgeBaseStatus(
            total_chunks=0,
            vector_db_path=settings.vector_db_path,
        )


def delete_collection(course: str) -> bool:
    """删除指定课程的知识库。"""
    try:
        client = _get_client()
        safe_name = _safe_collection_name(course)
        # 先尝试安全名称，失败则尝试原始名称（兼容旧数据）
        col = client.get_collection(safe_name)
        if not col:
            col = client.get_collection(course)
        if not col:
            return False
        client.delete_collection(col.name)
        return True
    except Exception:
        return False


def list_collections() -> list[dict]:
    """列出所有知识库集合。"""
    try:
        client = _get_client()
        collections = client.list_collections()
        return [
            {
                "name": col.metadata.get("course_name", col.name),
                "collection_name": col.name,
                "count": col.count(),
                "metadata": col.metadata,
                "_source": col.metadata.get("_source", "user"),
            }
            for col in collections
        ]
    except Exception:
        return []


def get_collection_content(course: str, limit: int = 200) -> dict:
    """获取指定集合的所有文档内容（切片列表）。"""
    try:
        collection = _get_collection(course)
        if not collection:
            # 兼容旧数据：直接用原始名称尝试获取（旧集合可能未经过 safe_name 编码）
            client = _get_client()
            collection = client.get_collection(course)
        if not collection:
            return {"success": False, "message": f"集合 '{course}' 不存在", "chunks": []}
        count = collection.count()
        if count == 0:
            return {"success": True, "course": course, "total": 0, "chunks": [], "metadata": dict(collection.metadata or {})}
        # 获取所有文档（使用自定义轻量向量存储的 get_all 方法）
        result = collection.get_all(limit=min(count, limit))
        chunks = []
        if result and result.get("documents"):
            for i, doc in enumerate(result["documents"]):
                meta = (result.get("metadatas") or [{}])[i] if i < len(result.get("metadatas") or []) else {}
                chunks.append({
                    "index": i,
                    "content": doc,
                    "source": meta.get("source", ""),
                    "chapter": meta.get("chapter", ""),
                })
        return {
            "success": True, "course": course, "total": count,
            "chunks": chunks,
            "metadata": dict(collection.metadata or {}),
        }
    except Exception as e:
        return {"success": False, "message": str(e), "chunks": []}


def tag_collection_source(course: str, source: str) -> None:
    """为集合标记来源（knowledge_base / materials / lesson_plan 等）。"""
    try:
        collection = _get_collection(course)
        if collection:
            meta = dict(collection.metadata or {})
            meta["_source"] = source
            collection.modify(metadata=meta)
    except Exception:
        pass
