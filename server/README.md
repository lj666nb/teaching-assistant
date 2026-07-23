# Edu-TA 共享数据库服务器

## 架构

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  助教端 (设备 A) │     │  服务器 (设备 C) │     │  助学端 (设备 B) │
│                 │     │                 │     │                 │
│  backend :8002  │────▶│  PostgreSQL     │◀────│  backend :8002  │
│  frontend :8080 │     │  :5432          │     │  frontend :8080 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## 部署步骤

### 1. 服务器端（设备 C）

```bash
# 上传 server/ 目录到服务器
scp -r server/ user@你的服务器IP:/opt/edu-ta-server/

# SSH 登录服务器
ssh user@你的服务器IP

# 配置密码
cd /opt/edu-ta-server
cp .env.example .env
nano .env   # 修改 DB_PASSWORD 为强密码

# 启动 PostgreSQL
docker compose -f docker-compose.server.yml up -d

# 验证
docker ps | grep edu-shared-db
```

### 2. 配置防火墙（重要）

在云服务器安全组中：
- **允许** 两个项目设备的出口 IP 访问端口 `5432`
- **拒绝** 其他所有来源访问 `5432`

或者先开放测试，后续收紧：
```bash
# 仅允许特定 IP（在服务器上执行）
iptables -A INPUT -p tcp --dport 5432 -s 助教端IP -j ACCEPT
iptables -A INPUT -p tcp --dport 5432 -s 助学端IP -j ACCEPT
iptables -A INPUT -p tcp --dport 5432 -j DROP
```

### 3. 助教端（设备 A）

```bash
# 在项目根目录
cd teaching-assistant-master

# 配置环境变量
cp server/.env.client.example .env.client
nano .env.client  # 填写服务器 IP 和密码

# 以客户端模式启动（不启动本地 PG，直连服务器）
docker compose -f server/docker-compose.client.yml --env-file .env.client up -d
```

### 4. 助学端（设备 B）

与步骤 3 相同，但将 `.env.client` 中的 `PROJECT_ID` 改为 `student-project`。

## 环境变量说明

| 变量 | 说明 | 助教端值 | 助学端值 |
|------|------|----------|----------|
| `DB_HOST` | 服务器 IP | `192.168.x.x` | `192.168.x.x` |
| `DB_PASSWORD` | 数据库密码 | 与服务器一致 | 与服务器一致 |
| `PROJECT_ID` | 项目标识 | `ta-project` | `student-project` |
| `PROJECT_TOKEN` | 互通令牌（可选） | 自定义 | 与助教端一致 |

## 验证互通

助教端批改一份作业 → 在服务器上查询：

```bash
docker exec edu-shared-db psql -U edu_admin -d edu_ta \
  -c "SELECT id, student_name, course_name, score, project_id FROM homework_grades ORDER BY created_at DESC LIMIT 5;"
```

助学端应该能查询到相同的记录。
