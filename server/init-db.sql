-- ─── Edu-TA 共享数据库初始化脚本 ───────────────────────────
-- PostgreSQL 容器首次启动时自动执行

-- 启用 UUID 扩展（备用）
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 预注册两个互通项目（表由后端应用首次连接时自动创建，
-- 此处仅做 PostgreSQL 级别的优化配置）
-- 调整参数适配中等并发场景
ALTER SYSTEM SET max_connections = '50';
ALTER SYSTEM SET shared_buffers = '128MB';
