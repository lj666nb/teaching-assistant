"""
LLM 集成服务 — 支持多供应商配置管理和一键切换。

用户可在网页中保存多个 LLM 供应商配置（名称/Key/地址/模型），
随时切换激活项，配置持久化存储到 providers.json。

优先级：请求头配置 > 激活的供应商配置 > 环境变量 > .env 文件默认值
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from openai import OpenAI, APIError

from app.config import settings

logger = logging.getLogger(__name__)


# ── 简单内存缓存 ──────────────────────────────────────
_cache: dict[str, tuple[float, str]] = {}
_CACHE_TTL = 86400  # 24 小时


def _cache_key(messages: list[dict], model: str, temperature: float) -> str:
    """生成缓存键（基于消息内容和参数）。"""
    raw = json.dumps([messages, model, temperature], ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _get_cache(key: str) -> str | None:
    """获取缓存（过期则返回 None）。"""
    now = time.time()
    entry = _cache.get(key)
    if entry and (now - entry[0]) < _CACHE_TTL:
        return entry[1]
    if entry:
        del _cache[key]
    return None


def _set_cache(key: str, value: str) -> None:
    _cache[key] = (time.time(), value)


def clear_cache() -> None:
    """清空 LLM 缓存（调试/测试用）。"""
    _cache.clear()


# ── 请求级配置（由中间件从 HTTP 头解析） ─────────────

@dataclass
class LLMConfig:
    """请求级 LLM 配置，优先级高于服务端存储的配置。"""
    api_key: str
    base_url: str = ""
    model_name: str = ""


_request_llm_config: ContextVar[LLMConfig | None] = ContextVar('_request_llm_config', default=None)


def set_request_config(config: LLMConfig | None) -> None:
    """为当前请求设置 LLM 配置（从 HTTP 头读取后调用）。"""
    _request_llm_config.set(config)


def get_request_config() -> LLMConfig | None:
    """获取当前请求的 LLM 配置。"""
    return _request_llm_config.get()

# ── 供应商存储 ─────────────────────────────────────────

# providers.json 存储路径：项目根目录下的 data/ 目录
# Docker 中映射到 /app/data/（持久化卷），本地开发时为 backend/data/
_PROJECT_ROOT = Path(__file__).parent.parent.parent
PROVIDERS_FILE = _PROJECT_ROOT / "data" / "providers.json"


def _ensure_file():
    """确保 providers.json 存在且格式正确。"""
    os.makedirs(PROVIDERS_FILE.parent, exist_ok=True)
    if not PROVIDERS_FILE.exists():
        PROVIDERS_FILE.write_text(json.dumps({"providers": [], "active_id": None}, indent=2), encoding="utf-8")


def _read_data() -> dict:
    _ensure_file()
    try:
        return json.loads(PROVIDERS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"providers": [], "active_id": None}


def _write_data(data: dict):
    _ensure_file()
    PROVIDERS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ── 供应商 CRUD ────────────────────────────────────────

def get_all_providers() -> list[dict]:
    """获取所有供应商配置。"""
    return _read_data().get("providers", [])


def save_provider(provider: dict):
    """
    新增或覆盖保存供应商。
    如果 provider["id"] 已存在则更新，否则追加。
    """
    data = _read_data()
    providers = data["providers"]
    found = False
    for i, p in enumerate(providers):
        if p["id"] == provider["id"]:
            providers[i] = provider
            found = True
            break
    if not found:
        providers.append(provider)
    _write_data(data)


def delete_provider(provider_id: str) -> bool:
    """删除供应商。如果删除的是激活项，自动清空激活 ID。"""
    data = _read_data()
    before = len(data["providers"])
    data["providers"] = [p for p in data["providers"] if p["id"] != provider_id]
    if data["active_id"] == provider_id:
        data["active_id"] = None
    _write_data(data)
    return len(data["providers"]) < before


def activate_provider(provider_id: str) -> bool:
    """切换激活指定供应商。"""
    data = _read_data()
    for p in data["providers"]:
        if p["id"] == provider_id:
            data["active_id"] = provider_id
            _write_data(data)
            return True
    return False


def get_active_provider() -> dict | None:
    """获取当前激活的供应商配置。"""
    data = _read_data()
    active_id = data.get("active_id")
    if not active_id:
        return None
    for p in data["providers"]:
        if p["id"] == active_id:
            return dict(p)
    return None


def _get_active_model() -> dict | None:
    """从激活的供应商中获取默认模型的配置。"""
    active = get_active_provider()
    if not active:
        return None
    models = active.get("models", [])
    if not models:
        return None
    # 优先取默认模型，否则取第一个
    default = next((m for m in models if m.get("is_default")), None)
    return default or models[0]


# ── 配置解析（优先级：请求头 > 激活供应商的默认模型 > 环境变量） ─

def _resolve_api_key() -> str:
    req_config = get_request_config()
    if req_config and req_config.api_key:
        return req_config.api_key
    model = _get_active_model()
    if model and model.get("api_key"):
        return model["api_key"]
    # 兼容旧版：api_key 可能直接存在 provider 顶层
    active = get_active_provider()
    if active and active.get("api_key"):
        return active["api_key"]
    return settings.llm_api_key


def _resolve_base_url() -> str:
    req_config = get_request_config()
    if req_config and req_config.base_url:
        return req_config.base_url
    active = get_active_provider()
    if active and active.get("base_url"):
        return active["base_url"]
    return settings.llm_base_url


def _resolve_model() -> str:
    req_config = get_request_config()
    if req_config and req_config.model_name:
        return req_config.model_name
    model = _get_active_model()
    if model and model.get("model_name"):
        return model["model_name"]
    # 兼容旧版
    active = get_active_provider()
    if active and active.get("model_name"):
        return active["model_name"]
    return settings.llm_model_name


# ── 全局系统提示词（所有教学助教对话自动前置） ──────

GLOBAL_SYSTEM_PROMPT = """你是高校人工智能（AI）专业教学的AI教师助教，仅承担教师助教工作，不做学生答疑、不做闲聊。
你所有能力严格基于AI学科权威教材、课程大纲、培养方案与科研体系。

强制性规则（必须遵守）：
1. 输出必须符合高校本科专业课教学范式，拒绝中小学话术与娱乐化表达。
2. 所有知识点、理论、结论、案例必须标注权威来源（教材章节/页码/文献/课程标号），100% 可追溯。
3. 输出内容末尾必须自动添加小字标识：【本内容由学科垂类AI助教生成】。
4. 具备多轮上下文记忆，可承接教师连续教学任务、迭代修改、反复优化。
5. 输出内容满足：教学严谨、逻辑规范、符合一流学科创新人才培养目标。
6. 禁止模型幻觉，不确定内容主动说明"该内容超出当前知识库范围"并仅输出已知内容。"""


def _build_messages(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    """自动将全局系统提示词前置到所有对话的 system 角色之前。"""
    # 检查是否已有全局提示，避免重复
    has_global = any(
        isinstance(m.get("content"), str) and GLOBAL_SYSTEM_PROMPT[:50] in m["content"]
        for m in messages if m.get("role") == "system"
    )
    if has_global:
        return messages

    # 找到第一个 system 消息，在其前面插入全局提示
    result = list(messages)
    system_idx = None
    for i, m in enumerate(result):
        if m.get("role") == "system":
            system_idx = i
            break

    if system_idx is not None:
        # 合并全局提示到现有的 system prompt 中
        existing = result[system_idx]["content"]
        result[system_idx] = {"role": "system", "content": f"{GLOBAL_SYSTEM_PROMPT}\n\n{existing}"}
    else:
        # 没有 system 消息，在前面插入
        result.insert(0, {"role": "system", "content": GLOBAL_SYSTEM_PROMPT})

    return result


# ── 客户端 ──────────────────────────────────────────────

def _create_client(api_key: str | None = None, base_url: str | None = None) -> OpenAI:
    return OpenAI(
        api_key=api_key or _resolve_api_key(),
        base_url=base_url or _resolve_base_url(),
    )


def get_client() -> OpenAI:
    return _create_client()


def chat(
    messages: list[dict[str, str]],
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    response_format: dict | None = None,
    use_cache: bool = True,
    max_retries: int = 2,
    **kwargs: Any,
) -> str:
    """发送对话请求（自动前置全局系统提示词）。

    特性：
    - 自动重试（LLM 返回空/报错时最多重试 2 次）
    - 请求缓存（相同 prompt 24h 内直接返回缓存）
    - LLM 调用日志记录到数据库
    """
    final_messages = _build_messages(messages)
    resolved_model = model or _resolve_model()

    # 缓存命中
    if use_cache:
        key = _cache_key(final_messages, resolved_model, temperature)
        cached = _get_cache(key)
        if cached is not None:
            return cached

    last_error = ""
    start = time.time()

    for attempt in range(max_retries + 1):
        try:
            client = _create_client()
            call_kwargs: dict[str, Any] = {
                "model": resolved_model,
                "messages": final_messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                **kwargs,
            }
            if response_format:
                call_kwargs["response_format"] = response_format
            resp = client.chat.completions.create(**call_kwargs)
            content = resp.choices[0].message.content or ""

            if not content.strip():
                last_error = "LLM returned empty content"
                continue

            # 记录日志
            _log_call(resolved_model, "chat", start, True)
            # 写入缓存
            if use_cache:
                _set_cache(key, content)
            return content

        except APIError as e:
            last_error = f"API error: {e.message[:100]}"
            logger.warning(f"LLM API error (attempt {attempt+1}): {last_error}")
            time.sleep(1 * (attempt + 1))
        except Exception as e:
            last_error = str(e)[:200]
            logger.warning(f"LLM error (attempt {attempt+1}): {last_error}")
            time.sleep(1 * (attempt + 1))

    # 所有重试都失败
    _log_call(resolved_model, "chat", start, False, last_error)
    raise RuntimeError(f"LLM 调用失败：{last_error}")


def _log_call(model: str, func: str, start: float, success: bool, error: str = "") -> None:
    """记录 LLM 调用日志到数据库（异步）。"""
    try:
        from app.models.database import LLMCallLog
        from app.models.database import SessionLocal
        db = SessionLocal()
        log = LLMCallLog(
            model=model,
            function_name=func,
            latency_ms=int((time.time() - start) * 1000),
            success=1 if success else 0,
            error_message=error[:500] if error else "",
        )
        db.add(log)
        db.commit()
        db.close()
    except Exception:
        pass  # 日志失败不影响主流程


def chat_json(
    messages: list[dict[str, str]],
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 8192,
    use_json_mode: bool = True,
) -> dict:
    """发送对话请求并解析 JSON 响应。

    优先使用 JSON mode（如果支持），失败则自动回退到普通文本模式提取 JSON。
    某些 LLM 供应商（如部分 DeepSeek/讯飞星火 版本）不支持 response_format，
    此时自动跳过 JSON mode，不影响正常使用。
    """
    # ── 第一轮：尝试 JSON mode（如果启用） ──
    if use_json_mode:
        try:
            content = chat(
                messages=messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            )
            return _extract_json(content)
        except Exception as e:
            # JSON mode 失败（可能是供应商不支持、API 报错、解析失败等）
            # 自动降级到普通文本模式，不影响用户体验
            logger.warning(f"JSON mode failed, falling back to text mode: {e}")

    # ── 第二轮：普通文本模式（兼容所有 LLM 供应商） ──
    last_error = None
    for attempt in range(2):
        try:
            content = chat(
                messages=messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return _extract_json(content)
        except (ValueError, json.JSONDecodeError) as e:
            last_error = e
            if attempt < 1:
                logger.warning(f"JSON parse failed, retrying ({attempt+1}/2): {e}")
        except Exception as e:
            # 非 JSON 解析错误（如 API 调用失败），不重试，直接抛出让上层降级
            last_error = e
            break

    raise ValueError(f"JSON 解析失败，AI 输出格式异常: {last_error}")


def _extract_json(text: str) -> dict:
    """从 LLM 响应中提取 JSON，兼容多种格式。"""
    text = text.strip()

    # 去掉 markdown 代码块包裹
    if text.startswith("```"):
        # 去掉 ```json 或 ``` 开头
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1:]
        # 去掉结尾的 ```
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3].strip()

    # 尝试直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 尝试提取第一个 { 到最后一个 } 之间的内容
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass

    # 尝试提取第一个 [ 到最后一个 ] (数组)
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            arr = json.loads(text[start:end + 1])
            # 如果是数组，包装为 {"exercises": arr} 方便调用方使用
            return {"exercises": arr}
        except json.JSONDecodeError:
            pass

    raise ValueError(f"无法从响应中解析 JSON: {text[:200]}...")


def chat_multimodal(
    text_prompt: str,
    image_base64: str,
    image_ext: str = "jpeg",
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 4096,
) -> str:
    """发送图文混合请求到多模态 LLM（用于批改手写作业照片等场景）。

    Parameters
    ----------
    text_prompt : str
        文字提示词（批改指令）。
    image_base64 : str
        图片的 base64 编码（不含 data: 前缀）。
    image_ext : str
        图片扩展名（默认 jpeg）。
    model : str | None
        模型名，默认使用配置中的模型（需支持视觉）。
    """
    resolved_model = model or _resolve_model()
    client = _create_client()

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": text_prompt},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/{image_ext};base64,{image_base64}",
                        "detail": "high",
                    },
                },
            ],
        }
    ]

    try:
        resp = client.chat.completions.create(
            model=resolved_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        content = resp.choices[0].message.content or ""
        return content
    except Exception as e:
        raise RuntimeError(f"多模态 LLM 调用失败: {str(e)[:200]}")


def chat_with_prompt(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.3,
    json_mode: bool = False,
) -> str | dict:
    """简化接口：传入 system 和 user 提示词。"""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    if json_mode:
        return chat_json(messages, temperature=temperature)
    return chat(messages, temperature=temperature)


# ── 连接测试 ──────────────────────────────────────────────

def test_llm_connection(
    api_key: str = "",
    base_url: str = "",
    model_name: str = "",
) -> tuple[bool, str]:
    """测试 LLM API 连接是否正常。"""
    try:
        client = _create_client(
            api_key=api_key or _resolve_api_key(),
            base_url=base_url or _resolve_base_url(),
        )
        model = model_name or _resolve_model()
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "请回复 OK"}],
            max_tokens=10,
            temperature=0,
        )
        content = resp.choices[0].message.content or ""
        return True, f"连接成功！模型返回：{content[:50]}"
    except APIError as e:
        code = getattr(e, "status_code", "?")
        return False, f"API 错误 ({code}): {e.message[:150]}"
    except Exception as e:
        msg = str(e)[:200]
        if "connection" in msg.lower() or "timeout" in msg.lower():
            return False, f"连接失败：无法访问 {base_url or _resolve_base_url()}，请检查地址是否正确"
        if "auth" in msg.lower() or "key" in msg.lower() or "403" in msg or "401" in msg:
            return False, "认证失败：API Key 无效或权限不足"
        return False, f"连接失败：{msg}"
