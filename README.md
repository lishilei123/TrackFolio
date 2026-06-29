# TrackFolio

> 单人自托管的股票与基金盈亏盯盘分析网站。

![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

TrackFolio 用于集中管理 A 股、美股、港股股票、ETF 与基金持仓。它以买入 / 卖出交易流水为数据源，自动计算持仓数量、平均成本、累计费用、今日盈亏、昨日盈亏、历史盈亏和总持仓盈亏，并支持 CNY / USD / HKD 统一结算货币折算。

详细需求见 [REQUIREMENTS.md](./REQUIREMENTS.md)。

## 目录

- [特性](#特性)
- [当前边界](#当前边界)
- [架构](#架构)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [常用脚本](#常用脚本)
- [配置](#配置)
- [资产导入导出](#资产导入导出)
- [数据存储](#数据存储)
- [生产部署](#生产部署)
- [Docker 部署](#docker-部署)
- [安全说明](#安全说明)
- [路线图](#路线图)

## 特性

- **持仓管理**：支持 A 股、美股、港股股票、场内 ETF、场外基金；支持搜索添加、手动添加和自定义标的。
- **交易流水驱动**：买入 / 卖出交易自动重算持仓数量、平均成本和累计费用；后台可新增、批量新增、编辑、删除交易流水。
- **定投补录**：支持基金定投批量生成交易；净值未披露的期次可先保存为“待确认”，后台任务在净值可用后自动折算补录。
- **盈亏看板**：展示总市值、今日盈亏、昨日盈亏、总持仓盈亏、历史曲线、持仓占比环形图和盈亏贡献。
- **历史分析**：DailyPnL 每日快照落库，支持近 7 / 30 / 90 天、今年、自定义区间，以及日 / 周 / 月 / 年粒度聚合。
- **多币种折算**：支持 CNY / USD / HKD 统一结算货币；汇率可按 Provider 自动获取或手动刷新，汇率异常时给出缺口提示。
- **行情 Provider**：股票、基金行情通过可替换 Provider Adapter 接入，运行时按市场和资产类型自动选择数据源；盘前 / 盘后盈亏计入口径可独立开启，默认关闭。
- **后台设置**：单实例后台密码保护，解锁后按资产配置、已实现盈亏、显示设置、安全分区管理；支持验证码、错误锁定、显示设置、主题设置、背景图、涨跌配色、盘前 / 盘后盈亏计入开关、行情校验、历史重算、汇率刷新和后台密码修改。
- **资产导入导出**：后台可将当前活跃持仓导出为版本化 JSON，也可导入 JSON 资产配置；导入会创建资产并生成买入交易来还原持仓。
- **体验优化**：前端缓存基础设置与元数据，提供玻璃态加载状态、移动端卡片布局、分页、筛选、排序和搜索。
- **单体同源部署**：一个 Fastify 进程同时提供前端页面和 `/api`，内置静态资源 ETag、Cache-Control 和 Brotli / gzip 压缩。

当前版本定位为单人自托管 MVP，不包含券商同步、交易下单、多用户账号体系，也不提供投资建议。

## 当前边界

已实现的核心能力包括：持仓和交易维护、后台密码保护、资产配置 JSON 导入导出、实时行情 / 基金净值刷新、多币种汇总、历史盈亏快照、持仓占比环形图、主题与显示设置、盘前 / 盘后盈亏计入口径控制、移动端基础适配。

以下能力仍属于后续迭代或部分实现：

- 独立资产详情页和单资产完整历史趋势页。
- 持仓列表列显隐、CSV 导出、完整数据备份与恢复。
- 按市场 / 类型拆分的完整历史贡献图。
- 分红、拆股、配股、税费等复杂交易事件。
- 券商账户同步、价格提醒、盈亏预警、自定义看板和 PWA。

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
├─ Dockerfile
└─ package.json            # npm workspaces 聚合入口
```

运行时请求路径：

```text
Browser -> Fastify :5174
          ├─ /api/*  -> API routes
          └─ /*      -> app/web/dist static files
```

主要后端模块：

- `routes/*`：API 路由，包括资产、资产配置导入导出、持仓、交易、历史、设置、后台认证。
- `repositories/*`：SQLite / PostgreSQL 数据访问。
- `services/*`：盈亏计算、行情刷新、历史快照、汇率、定投待确认回填。
- `providers/*`：股票 / 基金行情和汇率 Provider Adapter。

主要前端模块：

- `App.tsx`：首页看板与后台页路由。
- `components/OverviewCards.tsx`：总览指标卡。
- `components/HoldingsTable.tsx`：持仓表格与移动端持仓卡片。
- `components/Charts.tsx`、`components/HistoryChart.tsx`：盈亏图表。
- `components/HoldingsAllocationChart.tsx`：持仓占比环形图，按市值展示资产权重并与列表悬停联动。
- `components/AddAssetModal.tsx`：添加资产、建仓、批量定投补录。
- `components/AdminSettingsPage.tsx`、`components/AdminSidebar.tsx`：后台解锁与左侧分区导航（资产配置、已实现盈亏、显示设置、安全）下的运维操作。

## 技术栈

| 模块 | 技术 |
|---|---|
| Runtime | Node.js 22+ |
| Backend | Fastify 5, TypeScript, Zod |
| Frontend | React 19, Vite 6, Tailwind CSS 4, Recharts |
| Database | SQLite 默认，PostgreSQL 可选 |
| Package | npm workspaces |
| Deploy | Docker, 反向代理 |

## 快速开始

环境要求：

- Node.js 22+
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

首页看板可以直接查看；首次进入右上角“设置”后台前需要先解锁。默认初始密码为：

```text
admin
```

也可以在首次启动、数据库尚未初始化前通过环境变量指定强密码：

```bash
TRACKFOLIO_ADMIN_PASSWORD='your-strong-password' npm run dev
```

公网部署前请务必设置强初始密码，或首次进入后台后立即修改默认密码。

## 常用脚本

```bash
npm run dev      # 构建前端并启动开发服务
npm run build    # 构建 web 与 server
npm run start    # 启动已构建的 server
npm run test     # 运行服务端测试
```

## 配置

应用运行时配置通过环境变量读取，完整示例见 [.env.example](./.env.example)。Docker Run 的 `--env-file` 示例见 [.env.docker.example](./.env.docker.example)。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `5174` | 应用 HTTP 监听端口 |
| `LOG_LEVEL` | `info` | 日志级别：`fatal` / `error` / `warn` / `info` / `debug` / `trace` |
| `TRACKFOLIO_DB` | `app/server/data/trackfolio.sqlite` | SQLite 数据库路径 |
| `DATABASE_URL` | 空 | PostgreSQL 连接串；设置后启用 PostgreSQL。需要 SSL 时在连接串加 `?sslmode=require` |
| `TRACKFOLIO_ADMIN_PASSWORD` | `admin` | 初始后台密码；仅首次初始化数据库或既有库缺少密码 hash 时生效，公网部署请设为强密码 |
| `TRACKFOLIO_ADMIN_MAX_FAILED_ATTEMPTS` | `5` | 后台密码连续错误多少次后临时锁定 |
| `TRACKFOLIO_ADMIN_LOCK_MINUTES` | `15` | 后台临时锁定分钟数 |

其他显示与数据源偏好（结算货币、结算时区、刷新间隔、汇率 Provider、主题、背景图、涨跌配色、盘前 / 盘后盈亏计入等）在后台“显示设置”中维护并持久化到数据库。盘前 / 盘后盈亏计入默认关闭；开启后影响支持盘前 / 盘后交易状态的市场今日盈亏和实时历史点，不改变市场状态展示。

首页“持仓占比”使用当前活跃持仓的结算市值生成环形图。鼠标悬停环形图或右侧列表时会高亮对应资产；持仓超过 5 项时，环形图悬停会按当前资产做环形顺序展示，5 项及以内保持静态列表。

## 资产导入导出

后台“资产配置”区域提供“导出资产”和“导入资产”：

- 导出资产会下载 `trackfolio-allocation-YYYY-MM-DD.json`，内容为当前活跃持仓配置。
- 导入资产接受同格式 JSON，默认跳过已存在的活跃持仓，避免重复加仓。
- 导入会创建不存在的资产，并为每项配置生成一笔 `BUY` 交易，再由系统按交易流水重算持仓、成本和历史盈亏。
- 导出文件用于迁移或快速恢复当前持仓配置，不是完整交易流水备份；定投期次、待确认净值、历史行情、设置和后台密码不会包含在该文件中。

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

设置 `DATABASE_URL` 即可启用 PostgreSQL：

```bash
DATABASE_URL=postgres://user:password@localhost:5432/trackfolio npm start
```

表结构与 SQLite 保持一致，应用首次启动会自动建表并写入种子数据。托管数据库需要 SSL 时，在 `DATABASE_URL` 连接串中加入 `?sslmode=require`。

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

镜像由 GitHub Actions 在推送 `main` 或 `v*` tag 时构建并发布到 `ghcr.io/lishilei123/trackfolio`。发布 workflow 会同时写入 `latest`、`package.json` 版本号和 `sha-<commit>` 三类 tag。

### 直接使用 Docker Run（SQLite）

```bash
docker run -d \
  --name trackfolio \
  --restart unless-stopped \
  -p 8080:5174 \
  -v trackfolio-data:/data \
  -e TRACKFOLIO_DB=/data/trackfolio.sqlite \
  -e TRACKFOLIO_ADMIN_PASSWORD='your-strong-password' \
  ghcr.io/lishilei123/trackfolio:latest
```

也可以把容器运行时变量放入 `.env.docker` 后使用 `--env-file`：

```bash
docker run -d \
  --name trackfolio \
  --restart unless-stopped \
  -p 8080:5174 \
  -v trackfolio-data:/data \
  --env-file .env.docker \
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
  -e DATABASE_URL=postgres://trackfolio:change-me@trackfolio-postgres:5432/trackfolio \
  -e TRACKFOLIO_ADMIN_PASSWORD='your-strong-password' \
  ghcr.io/lishilei123/trackfolio:latest
```

请将示例中的 `change-me` 和 `your-strong-password` 都改为强密码，并确保 `POSTGRES_PASSWORD` 与 `DATABASE_URL` 中的数据库密码一致。

## 安全说明

- 初始后台密码默认是 `admin`；可通过 `TRACKFOLIO_ADMIN_PASSWORD` 指定首次初始化密码，公网部署前必须使用强密码或进入后台立即修改。
- 后台密码以 hash + salt 存储，不保存明文。
- 解锁后仅当前浏览器标签页会话获得 30 分钟 token，服务端只保存 token hash。
- 后台解锁支持连续错误临时锁定；解锁时可能要求验证码。
- 首页看板只读接口不需要登录；资产配置、资产导入导出、交易、历史回填、后台设置等管理接口需要 `X-Admin-Token`，并校验 `Origin` / `Referer` 是否与当前请求 Host 同源。
- 公网部署请优先使用 HTTPS，并让反向代理保留 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto`。
- 当前认证方案面向单人自托管，不是企业级多用户认证系统。
- 数据仅供个人盯盘参考，不构成投资建议。

## 路线图

- 已清仓资产归档列表和历史资产详情页。
- 单资产详情页、单资产历史趋势、按市场 / 类型拆分历史盈亏。
- 持仓列表 CSV 导出、列显隐、完整数据备份与恢复。
- 分红、拆股、配股、税费等复杂交易事件。
- 价格提醒和盈亏预警。
- 移动端 PWA 与更完整的手机端体验。
