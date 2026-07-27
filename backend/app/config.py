"""应用全局配置 — 从环境变量 / .env 文件加载。"""

import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── LLM ──
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model_name: str = "gpt-4o-mini"

    # ── Embedding ──
    embedding_model_name: str = "BAAI/bge-small-zh-v1.5"

    # ── 向量存储 ──
    vector_db_path: str = ""

    # ── 服务 ──
    host: str = "0.0.0.0"
    port: int = 8000

    # ── 数据库 — 云端 PostgreSQL（与项目11共用 tiaozhanbei） ──
    database_url: str = "postgresql+psycopg2://app_user:123456@113.45.66.152:5432/tiaozhanbei"

    # ── 项目互通标识 ──
    project_id: str = "ta-project"          # 项目唯一标识（助教端 / 助学端）
    project_token: str = ""                 # 互通认证令牌

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # 默认向量数据库路径
        if not self.vector_db_path:
            self.vector_db_path = str(
                Path(__file__).parent.parent / "knowledge_base" / "vector_store"
            )
        # 确保目录存在
        os.makedirs(self.vector_db_path, exist_ok=True)
        os.makedirs(
            Path(__file__).parent.parent / "knowledge_base" / "textbooks",
            exist_ok=True,
        )


settings = Settings()
