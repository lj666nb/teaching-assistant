"""
轻量向量存储 — 基于 SQLite + NumPy 的 ChromaDB 替代方案。

零新增依赖（复用 aiosqlite + numpy），
纯 Python 实现余弦相似度检索，适合单机小规模知识库。
"""

from __future__ import annotations

import json
import os
import sqlite3
from typing import Any

import numpy as np


def _serialize(vec: list[float]) -> bytes:
    """将 float 列表序列化为 numpy bytes。"""
    return np.array(vec, dtype=np.float32).tobytes()


def _deserialize(blob: bytes) -> np.ndarray:
    """从 bytes 反序列化为 numpy 数组。"""
    return np.frombuffer(blob, dtype=np.float32)


def _cosine_similarity(query: np.ndarray, candidates: np.ndarray) -> np.ndarray:
    """计算余弦相似度（归一化后等价于点积）。"""
    if candidates.size == 0:
        return np.array([])
    q = query / (np.linalg.norm(query) + 1e-8)
    c = candidates / (np.linalg.norm(candidates, axis=1, keepdims=True) + 1e-8)
    return np.dot(c, q)


class Collection:
    """轻量集合 — 等价于 ChromaDB Collection 的 API 子集。"""

    def __init__(self, name: str, db_path: str):
        self.name = name
        self.db_path = db_path
        self.metadata: dict[str, Any] = {}
        self._init_table()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_table(self):
        table_sql = (
            'CREATE TABLE IF NOT EXISTS "' + self.name + '" ('
            'id TEXT PRIMARY KEY, '
            'document TEXT NOT NULL, '
            'embedding BLOB NOT NULL, '
            "metadata TEXT DEFAULT '{}'"
            ')'
        )
        with self._conn() as conn:
            conn.execute(table_sql)
            conn.commit()

    def count(self) -> int:
        sql = 'SELECT COUNT(*) FROM "' + self.name + '"'
        with self._conn() as conn:
            row = conn.execute(sql).fetchone()
            return row[0] if row else 0

    def add(
        self,
        ids: list[str],
        documents: list[str] | None = None,
        embeddings: list[list[float]] | None = None,
        metadatas: list[dict[str, Any]] | None = None,
    ):
        documents = documents or [""] * len(ids)
        embeddings = embeddings or [[0.0]] * len(ids)
        metadatas = metadatas or [{}] * len(ids)

        rows = [
            (id_, doc, _serialize(emb), json.dumps(meta, ensure_ascii=False))
            for id_, doc, emb, meta in zip(ids, documents, embeddings, metadatas)
        ]
        insert_sql = (
            'INSERT OR REPLACE INTO "' + self.name
            + '" (id, document, embedding, metadata) VALUES (?, ?, ?, ?)'
        )
        with self._conn() as conn:
            conn.executemany(insert_sql, rows)
            conn.commit()

    def query(
        self,
        query_embeddings: list[list[float]] | None = None,
        n_results: int = 10,
        where: dict[str, Any] | None = None,
    ) -> dict[str, list[list[Any]]]:
        """返回格式兼容 ChromaDB query 结果。"""
        result: dict[str, list[list[Any]]] = {
            "ids": [[]],
            "documents": [[]],
            "metadatas": [[]],
            "distances": [[]],
        }
        if not query_embeddings:
            return result

        select_sql = 'SELECT id, document, embedding, metadata FROM "' + self.name + '"'
        with self._conn() as conn:
            rows = conn.execute(select_sql).fetchall()

        if not rows:
            return result

        all_ids = [r[0] for r in rows]
        all_docs = [r[1] for r in rows]
        all_vecs = np.array([_deserialize(r[2]) for r in rows])
        all_metas = [json.loads(r[3]) for r in rows]

        for q_vec in query_embeddings:
            q = np.array(q_vec, dtype=np.float32)
            scores = _cosine_similarity(q, all_vecs)

            # 按相似度降序取 top_k
            if len(scores) <= n_results:
                indices = list(range(len(scores)))
            else:
                indices = np.argpartition(-scores, n_results)[:n_results]
                indices = indices[np.argsort(-scores[indices])]

            # where 过滤
            if where:
                filtered = []
                for i in indices:
                    meta = all_metas[i]
                    match = all(meta.get(k) == v for k, v in where.items())
                    if match:
                        filtered.append(i)
                indices = filtered

            result_ids = [all_ids[i] for i in indices]
            result_docs = [all_docs[i] for i in indices]
            result_metas = [all_metas[i] for i in indices]
            result_dists = [1.0 - float(scores[i]) for i in indices]

            result["ids"][0].extend(result_ids)
            result["documents"][0].extend(result_docs)
            result["metadatas"][0].extend(result_metas)
            result["distances"][0].extend(result_dists)

        return result

    def get_all(self, limit: int = 200) -> dict:
        """获取集合中的所有文档（不进行向量检索）。"""
        result: dict[str, list[Any]] = {
            "ids": [], "documents": [], "metadatas": [],
        }
        select_sql = 'SELECT id, document, metadata FROM "' + self.name + '" LIMIT ?'
        with self._conn() as conn:
            rows = conn.execute(select_sql, (limit,)).fetchall()
        for row in rows:
            result["ids"].append(row[0])
            result["documents"].append(row[1])
            result["metadatas"].append(json.loads(row[2]))
        return result

    def delete(self):
        """删除整个集合（表）。"""
        sql = 'DROP TABLE IF EXISTS "' + self.name + '"'
        with self._conn() as conn:
            conn.execute(sql)
            conn.commit()


class PersistentClient:
    """轻量持久化客户端 — 等价于 ChromaDB PersistentClient 的 API 子集。"""

    def __init__(self, path: str, settings: Any = None):
        os.makedirs(path, exist_ok=True)
        self.db_path = os.path.join(path, "vector_store.db")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS _collections ("
                "name TEXT PRIMARY KEY, "
                "metadata TEXT DEFAULT '{}'"
                ")"
            )
            conn.commit()

    def get_or_create_collection(
        self, name: str, metadata: dict[str, Any] | None = None
    ) -> Collection:
        col = Collection(name, self.db_path)
        col.metadata = metadata or {}
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO _collections (name, metadata) VALUES (?, ?)",
                (name, json.dumps(col.metadata, ensure_ascii=False)),
            )
            conn.commit()
        return col

    def get_collection(self, name: str) -> Collection | None:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT name, metadata FROM _collections WHERE name = ?", (name,)
            ).fetchone()
        if not row:
            return None
        col = Collection(name, self.db_path)
        col.metadata = json.loads(row[1])
        return col

    def list_collections(self) -> list[Collection]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute("SELECT name, metadata FROM _collections").fetchall()
        result = []
        for name, meta_json in rows:
            col = Collection(name, self.db_path)
            col.metadata = json.loads(meta_json)
            result.append(col)
        return result

    def delete_collection(self, name: str):
        col = Collection(name, self.db_path)
        col.delete()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM _collections WHERE name = ?", (name,))
            conn.commit()
