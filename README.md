# TrackFolio

> 单人自托管的股票与基金盈亏盯盘分析网站。

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

TrackFolio 用于集中管理 A 股、美股、港股股票、ETF 与基金持仓。它通过买入 / 卖出交易流水自动计算持仓数量、平均成本、今日盈亏、昨日盈亏、历史盈亏和总持仓盈亏，并支持 CNY / USD / HKD 统一结算货币折算。

详细需求见 [REQUIREMENTS.md](./REQUIREMENTS.md)。

## 目录

- [特性](#特性)
- [架构](#架构)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [配置](#配置)
- [数据存储](#数据存储)
- [生产部署](#生产部署)
- [Docker 部署](#docker-部署)
- [安全说明](#安全说明)
- [路线图](#路线图)

## 特性

- **持仓管理**：支持 A 股、美股、港股股票、场内 ETF、场外基金；支持搜索添加和自定义标的。
- **交易流水驱动**：买入 / 卖出交易自动重算持仓数量、平均成本和累计费用；后台可新增、编辑、删除流水。
- **盈亏看板**：展示总市值、今日盈亏、昨日盈亏、总持仓盈亏、持仓分布和今日盈亏贡献。
- **历史曲线**：DailyPnL 每日快照落库，支持近 7 / 30 / 90 天和今年的累计盈亏折线与每日盈亏柱状图。
- **多币种折算**：支持 CNY / USD / HKD 统一结算货币，汇率可自动刷新或手动刷新。
- **行情 Provider**：默认 `auto`，按可达性在新浪 / Yahoo 之间自动选择并兜底。
- **后台设置**：密码保护、显示设置、主题设置、行情校验、历史重算、汇率刷新、后台密码修改。
- **单体同源部署**：一个 Fastify 进程同时提供前端页面和 `/api`，避免前后端跨域部署复杂度。

当前版本定位为单人自托管 MVP，不包含券商同步、交易下单、多用户账号体系，也不提供投资建议。

## 架构

TrackFolio 是单体应用：React 前端只在构建阶段生成静态资源，运行时由同一个 Node.js + Fastify 服务托管页面和 API。

```text
TrackFolio/
├─ app/
│  ├─ server/              # Fastify API、数据层、Provider、后台任务
│  │  ├─ src/
│  │  └─ data/             # 默认 SQLite 数据目录
│  └─ web/                 # React + Vite 前端源码
│     ├─ src/
│     └─ dist/             # 构建产物，由 app/server 托管
├─ compose.yaml            # SQLite 默认部署
├─ compose.postgres.yaml   # PostgreSQL 可选叠加部署
├─ Dockerfile
└─ package.json            # npm workspaces 聚合入口
```

运行时请求路径：

```text
Browser -> Fastify :5174
          ├─ /api/*  -> API routes
          └─ /*      -> app/web/dist static files
```

## 技术栈

| 模块 | 技术 |
|---|---|
| Runtime | Node.js 20+ |
| Backend | Fastify 5, TypeScript, Zod |
| Frontend | React 19, Vite 6, Tailwind CSS 4, Recharts |
| Database | SQLite 默认，PostgreSQL 可选 |
| Package | npm workspaces |
| Deploy | Docker, Docker Compose, 反向代理 |

## 快速开始

环境要求：

- Node.js 20+
- npm

安装依赖并启动开发服务：

```bash
npm install
npm run dev
```

打开：

```text
http://localhost:5174
```

开发模式会先构建 `app/web/dist`，再启动同一个 Fastify 单体服务。页面和 `/api` 都走同一域名、同一端口。

首次进入右上角“设置”后台前需要先解锁。默认初始密码为：

```text
admin
```

也可以在首次启动、数据库尚未初始化前通过环境变量指定强密码：

```bash
TRACKFOLIO_ADMIN_PASSWORD='your-strong-password' npm run dev
```

公网部署前请务必设置强初始密码，或首次进入后台后立即修改默认密码。

## 配置

应用运行时配置通过环境变量读取，完整示例见 [.env.example](./.env.example)。Docker Compose 变量示例见 [.env.docker.example](./.env.docker.example)。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `5174` | 应用 HTTP 监听端口 |
| `LOG_LEVEL` | `info` | 日志级别：`fatal` / `error` / `warn` / `info` / `debug` / `trace` |
| `TRACKFOLIO_WEB_ROOT` | 自动定位 `app/web/dist` | 前端静态文件目录，通常无需设置 |
| `TRACKFOLIO_DB` | `app/server/data/trackfolio.sqlite` | SQLite 数据库路径 |
| `DB_DRIVER` | 自动推断 | `sqlite` / `postgres`；设置 `DATABASE_URL` 后自动使用 PostgreSQL |
| `DATABASE_URL` | 空 | PostgreSQL 连接串 |
| `PG_POOL_MAX` | `10` | PostgreSQL 连接池大小 |
| `PGSSL` | 空 | 设为 `require` 时启用 PostgreSQL SSL |
| `TRACKFOLIO_ADMIN_PASSWORD` | `admin` | 初始后台密码；仅首次初始化数据库或既有库缺少密码 hash 时生效，公网部署请设为强密码 |
| `TRACKFOLIO_ADMIN_MAX_FAILED_ATTEMPTS` | `5` | 后台密码连续错误多少次后临时锁定 |
| `TRACKFOLIO_ADMIN_LOCK_MINUTES` | `15` | 后台临时锁定分钟数 |
| `TRACKFOLIO_PROVIDER` | `auto` | 行情源：`auto` / `sina` / `yahoo` |
| `TRACKFOLIO_FX_PROVIDER` | 跟随后台设置 | 汇率源：`auto` / `exchangerate` / `yahoo` / `mock` |




Docker Compose 额外支持以下变量用于镜像、宿主机端口和 PostgreSQL 密码配置：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `TRACKFOLIO_IMAGE` | `trackfolio:local` | Compose 构建 / 运行使用的镜像名 |
| `TRACKFOLIO_HTTP_PORT` | `8080` | 映射到宿主机的 HTTP 端口，容器内固定为 `5174` |
| `TRACKFOLIO_POSTGRES_PASSWORD` | `change-me` | PostgreSQL 叠加部署时的数据库密码 |

## 数据存储

### SQLite 默认

默认数据库文件：

```text
app/server/data/trackfolio.sqlite
```

自定义路径：

```bash
TRACKFOLIO_DB=/path/to/trackfolio.sqlite npm run dev
```

该 `.sqlite` 文件即全部数据。WAL 模式下还会有同名的 `-wal` / `-shm` 文件，备份或挂载卷时需要一并处理。

### PostgreSQL 可选

设置 `DATABASE_URL` 即可启用 PostgreSQL，也可显式设置 `DB_DRIVER=postgres`：

```bash
DATABASE_URL=postgres://user:password@localhost:5432/trackfolio npm start
```

表结构与 SQLite 保持一致，应用首次启动会自动建表并写入种子数据。托管数据库需要 SSL 时设置 `PGSSL=require`。

## 生产部署

构建：

```bash
npm run build
```

启动：

```bash
node --env-file=.env app/server/dist/index.js
```

浏览器访问后端监听端口即可：

```text
http://localhost:5174
```

## Docker 部署
### 直接使用 Docker Run（SQLite）


```bash
docker run -d \
  --name trackfolio \
  --restart unless-stopped \
  -p 8080:5174 \
  -v trackfolio-data:/data \
  -e NODE_ENV=production \
  -e TRACKFOLIO_DB=/data/trackfolio.sqlite \
  -e TRACKFOLIO_ADMIN_PASSWORD='your-strong-password' \
  ghcr.io/lishilei123/trackfolio:latest
```

### 直接使用 Docker Run（PostgreSQL）

如需使用 PostgreSQL，可以先创建专用网络，再分别启动数据库和 TrackFolio：

```bash
docker network create trackfolio-net

docker run -d \
  --name trackfolio-postgres \
  --restart unless-stopped \
  --network trackfolio-net \
  -v trackfolio-pgdata:/var/lib/postgresql/data \
  -e POSTGRES_USER=trackfolio \
  -e POSTGRES_PASSWORD=change-me \
  -e POSTGRES_DB=trackfolio \
  postgres:16-alpine

docker run -d \
  --name trackfolio \
  --restart unless-stopped \
  --network trackfolio-net \
  -p 8080:5174 \
  -e NODE_ENV=production \
  -e DB_DRIVER=postgres \
  -e DATABASE_URL=postgres://trackfolio:change-me@trackfolio-postgres:5432/trackfolio \
  -e TRACKFOLIO_ADMIN_PASSWORD='your-strong-password' \
  ghcr.io/lishilei123/trackfolio:latest
```

请将示例中的 `change-me` 和 `your-strong-password` 都改为强密码，并确保 `POSTGRES_PASSWORD` 与 `DATABASE_URL` 中的数据库密码一致。

## 安全说明

- 初始后台密码默认是 `admin`；可通过 `TRACKFOLIO_ADMIN_PASSWORD` 指定首次初始化密码，公网部署前必须使用强密码或进入后台立即修改。
- 后台密码以 hash + salt 存储，不保存明文。
- 解锁后仅当前浏览器标签页会话获得 30 分钟 token，服务端只保存 token hash。
- 持仓、交易、历史和后台接口需要 `X-Admin-Token`，并校验 `Origin` / `Referer` 是否与当前请求 Host 同源。
- 公网部署请优先使用 HTTPS，并让反向代理保留 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto`。
- 当前认证方案面向单人自托管，不是企业级多用户认证系统。

## 路线图

- 已清仓资产归档列表和历史资产详情页。
- 单资产详情页、单资产历史趋势、按市场 / 类型拆分历史盈亏。
- 持仓列表 CSV 导出、数据备份与恢复。
- 分红、拆股、配股、税费等复杂交易事件。
- 价格提醒和盈亏预警。
