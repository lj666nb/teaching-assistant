"""
Embedding 服务 — 优先调用 API，轻量降级方案。

优先级：
1. LLM 供应商的 Embedding API（OpenAI 兼容接口）
2. 基于哈希的确定性伪随机向量（零依赖，无需下载模型）
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np
from openai import OpenAI

from app.config import settings


@lru_cache(maxsize=1)
def _get_client() -> OpenAI | None:
    """
    获取 OpenAI 兼容客户端用于 Embedding API。
    优先使用当前请求级配置或激活的供应商配置。
    """
    from app.core.llm import get_request_config, get_active_provider

    # 请求级配置（用户浏览器配置的）
    req_config = get_request_config()
    if req_config and req_config.api_key and req_config.base_url:
        return OpenAI(api_key=req_config.api_key, base_url=req_config.base_url)

    # 服务端激活的供应商配置（多模型结构：api_key 在 models[默认].api_key）
    active = get_active_provider()
    if active and active.get("base_url"):
        models = active.get("models", [])
        if models:
            default_model = next((m for m in models if m.get("is_default")), models[0])
            if default_model.get("api_key"):
                return OpenAI(api_key=default_model["api_key"], base_url=active["base_url"])
        # 兼容旧版：api_key 在 provider 顶层
        if active.get("api_key"):
            return OpenAI(api_key=active["api_key"], base_url=active["base_url"])

    # 环境变量兜底
    if settings.llm_api_key and settings.llm_base_url:
        return OpenAI(api_key=settings.llm_api_key, base_url=settings.llm_base_url)

    return None


def _api_embed(texts: list[str]) -> list[list[float]] | None:
    """
    通过 OpenAI 兼容的 Embedding API 获取向量。

    尝试常用 embedding 模型名，返回 None 表示 API 不支持。
    """
    client = _get_client()
    if not client:
        return None

    # 尝试的模型列表（按质量排序，优先用第一个成功的）
    models = [
        "text-embedding-3-small",       # OpenAI / 多数兼容服务
        "text-embedding-3-large",       # OpenAI
        "text-embedding-ada-002",       # OpenAI 旧版
        "BAAI/bge-large-zh-v1.5",       # SiliconFlow 等国内服务
        "BAAI/bge-small-zh-v1.5",      # 轻量中文
        "deepseek-embedding",           # DeepSeek
    ]

    for model in models:
        try:
            resp = client.embeddings.create(input=texts, model=model)
            vectors = [d.embedding for d in resp.data]
            if vectors:
                return vectors
        except Exception:
            continue

    return None


def get_embedding(text: str) -> list[float]:
    """
    获取文本的嵌入向量。
    尝试 API，失败则使用哈希降级方案。
    """
    vecs = embed_batch([text])
    return vecs[0] if vecs else _hash_embedding(text)


def embed_batch(texts: list[str]) -> list[list[float]]:
    """
    批量获取文本向量。
    优先 API，失败则逐条使用哈希降级方案。
    """
    vectors = _api_embed(texts)
    if vectors is not None:
        return vectors
    return [_hash_embedding(t) for t in texts]


def _hash_embedding(text: str) -> list[float]:
    """
    基于 SHA-256 的确定性伪随机向量（384维）。
    零依赖，结果确定，适合开发和演示环境。
    """
    import hashlib
    h = hashlib.sha256(text.encode("utf-8")).digest()
    seed = int.from_bytes(h[:4], "big")
    rng = np.random.RandomState(seed)
    vec = rng.randn(384).tolist()
    norm = np.linalg.norm(vec)
    return (np.array(vec) / norm).tolist()
