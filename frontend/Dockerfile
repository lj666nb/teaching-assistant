# syntax=docker/dockerfile:1

# ─── 学科助教系统 Edu-TA — 前端 Dockerfile（多阶段构建） ────
# Stage 1: 使用 Node 构建 React 应用
# Stage 2: 使用 Nginx 运行

# ── Stage 1: 构建 ─────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

# 使用国内 npm 镜像加速依赖安装
RUN npm config set registry https://registry.npmmirror.com

# 先复制依赖文件以利用 Docker 层缓存
COPY package.json package-lock.json ./

# BuildKit cache mount 持久化 npm 缓存，跨构建复用
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# 只复制构建需要的文件（跳过 .mcp.json、Dockerfile、nginx.conf 等无关文件）
COPY src/ ./src/
COPY public/ ./public/
COPY index.html .
COPY vite.config.ts .
COPY tsconfig.json tsconfig.node.json ./

RUN npm run build

# ── Stage 2: 运行（Nginx Alpine） ─────────────────────────
FROM nginx:alpine

# 复制构建产物
COPY --from=builder /build/dist /usr/share/nginx/html

# 复制 Nginx 配置（含 API 反向代理 + SPA 路由）
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 日志输出到标准输出（方便 docker logs 查看）
RUN ln -sf /dev/stdout /var/log/nginx/access.log && \
    ln -sf /dev/stderr /var/log/nginx/error.log

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
