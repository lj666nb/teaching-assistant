# syntax=docker/dockerfile:1

# ─── 学科助教系统 Edu-TA  —  后端 Dockerfile（精简版） ──────
# 已移除 sentence-transformers / torch，无需 gcc/g++ 编译。
# 构建更快、镜像更小、内存占用更低。
#
# 使用方式: DOCKER_BUILDKIT=1 docker build -t edu-ta-backend ./backend

# ── Stage 1: 构建 ──────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# 复制依赖文件并安装（纯 Python 包，无需编译）
# BuildKit cache mount 持久化 pip 缓存，跨构建复用
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt


# ── Stage 2: 运行 ──────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# 安装 Tesseract OCR（图片批改回退方案）
# BuildKit cache mount 持久化 apt 缓存，跨构建复用
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    echo 'deb https://mirrors.tuna.tsinghua.edu.cn/debian/ trixie main contrib non-free non-free-firmware' > /etc/apt/sources.list &&     echo 'deb https://mirrors.tuna.tsinghua.edu.cn/debian/ trixie-updates main contrib non-free non-free-firmware' >> /etc/apt/sources.list &&     echo 'deb https://mirrors.tuna.tsinghua.edu.cn/debian-security trixie-security main contrib non-free non-free-firmware' >> /etc/apt/sources.list &&     apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-chi-tra \
    && rm -rf /var/lib/apt/lists/*

# 从构建阶段复制已安装的 Python 包
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# 只复制运行时需要的代码（跳过 tests/、Dockerfile、.dockerignore 等）
COPY app/ ./app/

# 创建运行时需要的目录（vector_store、textbooks、data 通过 volume 挂载）
RUN mkdir -p /app/knowledge_base/vector_store \
             /app/knowledge_base/textbooks \
             /app/data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
