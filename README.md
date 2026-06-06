# TrackFolio

股票与基金盈亏盯盘分析网站。集中管理 A 股、美股、港股股票与基金持仓，通过买入 / 卖出交易流水自动计算持仓数量、平均成本、今日 / 昨日 / 历史 / 总持仓盈亏，并支持 CNY / USD / HKD 统一结算货币折算。

> 详细需求见 [REQUIREMENTS.md](./REQUIREMENTS.md)。

## 技术栈

- **server** — Node.js + Fastify + TypeScript。数据层支持 **SQLite（默认，零配置）** 与 **PostgreSQL（生产可选）**，通过统一驱动抽象切换。行情通过可替换的 Provider Adapter 接入，支持 `auto` / `sina` / `yahoo` Provider。
- **web** — React + TypeScript + Vite + Tailwind CSS + Recharts，极客深色盯盘看板。

## 快速开始

建议使用 Node.js 20+。

```bash
npm install
npm run dev
```

打开 http://localhost:5173 。前端通过 Vite 代理把 `/api` 转发到后端 http://localhost:5174。

首次进入右上角“设置”后台时，默认后台密码为：

```text
admin
```

进入后台后建议立即修改密码。

## 当前完成度

当前版本已具备单人自托管 MVP 的核心能力：本地维护资产与交易流水、自动刷新行情 / 汇率、生成盈亏看板与历史曲线。仍不包含券商同步、交易下单、多用户账号体系或投资建议。

### 已实现

- 资产添加与建仓
  - 支持 A 股 / 美股 / 港股股票、场内 ETF、场外基金。
  - 支持搜索添加，也支持自定义标的。
  - 已存在资产再次添加时按加仓处理。

- 交易流水驱动持仓
  - 买入 / 卖出交易会自动重算持仓数量、平均成本、累计费用。
  - 后台支持查看、添加、编辑、删除交易流水（删除流水用于纠错）。
  - 后台支持清仓归档：通过新增卖出交易将持仓清为 0，保留资产、交易流水和历史记录。

- 盈亏计算
  - 今日盈亏。
  - 昨日盈亏。
  - 总持仓盈亏。
  - 建仓首日按“收盘价 - 买入均价”计算当日 / 昨日收益，避免把未持有期间的行情涨跌计入用户收益。
  - 交易变更后会按交易流水从最早交易日起重算该资产历史 DailyPnL 快照。

- 历史盈亏
  - DailyPnL 每日快照落库。
  - 账户累计盈亏折线 + 每日盈亏柱状图。
  - 时间范围切换：近 7 / 30 / 90 天、今年。
  - 支持悬停查看日期、金额、主要贡献。
  - 首次启动可由 Provider 回填约 90 天合成历史，之后随刷新逐日累加。

- 行情 / 净值 Provider
  - 默认 `auto` Provider：按可达性在新浪 / Yahoo 之间自动选择并兜底。
  - 可通过 `TRACKFOLIO_PROVIDER=sina|yahoo|auto` 指定 Provider。
  - 支持自动刷新、手动刷新，失败时保留最后成功数据并降级显示状态。

- 实时汇率折算
  - 支持 CNY / USD / HKD 之间实时汇率刷新。
  - 默认 `auto` FX Provider：优先使用公开实时汇率 API，失败后尝试 Yahoo FX，再失败则保留最后成功汇率。
  - 后台可切换汇率 Provider：`auto` / `exchangerate` / `yahoo` / `mock`。
  - 手动刷新和后台自动刷新都会同步刷新汇率。

- 首页盯盘看板
  - 总览指标：总市值、今日盈亏、昨日盈亏、总持仓盈亏。
  - 持仓市值分布。
  - 今日盈亏贡献。
  - 持仓明细：筛选、排序、搜索。
  - 统一结算货币切换：CNY / USD / HKD。

- 后台设置
  - 右上角“设置”进入后台。
  - 后台密码保护，默认密码为 `admin`。
  - 密码以 hash + salt 存储，不明文保存；解锁后仅当前浏览器获得 30 分钟 token，会话 token 只以 hash 存库。
  - 后台写操作校验 token 与请求来源；跨域仅允许本地开发地址，公网建议通过同源反向代理访问 `/api`。
  - 后台可修改显示设置、添加资产、编辑交易流水、清仓归档、重新校验行情与历史盈亏、刷新汇率、修改后台密码。

- 外观与显示设置
  - 主题：深色 / 浅色 / 自动（跟随系统）/ 自定义。
  - 自定义主题：在深 / 浅底座上用取色器调强调色、背景、面板、边框、主 / 次文字，其余色板按透明度与明度自动派生。
  - 自定义背景图：上传图片（前端自动压缩后随设置以 base64 存库），支持暗度遮罩与模糊，保证数据与玻璃面板在任意照片上仍清晰可读。
  - 涨跌配色：绿涨红跌（终端风格）/ 红涨绿跌（A 股习惯）。
  - 所有显示设置即时预览，保存后持久化，刷新 / 换设备一致。

### 仍未完整实现 / 后续增强

- 已清仓资产的归档列表 / 历史资产详情页尚未单独展示。
- 单资产详情页、单资产历史趋势、按市场 / 类型拆分历史盈亏仍待完善。
- 持仓列表 CSV 导出、数据备份与恢复尚未实现。
- 分红、拆股、配股、税费等复杂交易事件尚未细化。
- 价格提醒、盈亏预警尚未实现。

## 开发

```bash
npm install          # 安装 server 与 web 依赖（workspaces）
npm run dev          # 同时启动后端(:5174) 与前端(:5173)
```

单独运行：

```bash
npm run dev:server   # 仅后端
npm run dev:web      # 仅前端
npm test             # 后端单元测试
npm run build        # 构建 server 与 web
```

## 数据存储

支持两种数据库，由环境变量决定，应用启动时自动建表与写入种子数据。

### SQLite（默认）

零配置，适合开发与单机部署。数据库文件默认位于：

```text
server/data/trackfolio.sqlite
```

可通过环境变量覆盖路径：

```bash
TRACKFOLIO_DB=/path/to/trackfolio.sqlite npm run dev:server
```

> 该 `.sqlite` 文件即全部数据。WAL 模式下还会有同名的 `-wal` / `-shm` 附属文件，备份 / 挂载卷时一并考虑。

### PostgreSQL（生产可选）

设置 `DATABASE_URL` 即自动启用（或显式 `DB_DRIVER=postgres`）：

```bash
DATABASE_URL=postgres://user:password@localhost:5432/trackfolio npm run start --workspace server
```

- 表结构与 SQLite 完全一致，应用首次启动会自动建表 + 灌入种子数据，无需手动迁移。
- 连接池大小：`PG_POOL_MAX`（默认 10）。
- 托管数据库（Neon / Supabase / RDS 等）需要 SSL 时设 `PGSSL=require`。

## Provider 配置

行情 Provider 默认使用：

```bash
TRACKFOLIO_PROVIDER=auto
```

可选值：

- `auto`：默认，新浪 / Yahoo 自动探测与兜底。
- `sina`：优先使用新浪 / 腾讯 / 东方财富相关接口，适合中文搜索与国内市场。
- `yahoo`：使用 Yahoo Finance，适合部分境外环境。

实时汇率 Provider 默认使用：

```bash
TRACKFOLIO_FX_PROVIDER=auto
```

可选值：

- `auto`：默认，实时汇率 API → Yahoo FX → mock 依次兜底。
- `exchangerate`：使用公开实时汇率 API。
- `yahoo`：使用 Yahoo Finance FX。
- `mock`：使用本地固定 fallback 汇率。

示例：

```bash
TRACKFOLIO_PROVIDER=sina TRACKFOLIO_FX_PROVIDER=mock npm run dev:server
```

## 部署 / 环境变量

所有配置通过**环境变量**读取，均有默认值（开箱即用）。完整示例见 [.env.example](./.env.example)。

### 环境变量一览（均为后端 server 使用）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `5174` | 后端 HTTP 监听端口，host 固定 `0.0.0.0` |
| `LOG_LEVEL` | `info` | 日志级别 `fatal\|error\|warn\|info\|debug\|trace` |
| `TRACKFOLIO_DB` | `server/data/trackfolio.sqlite` | SQLite 数据库文件路径（目录自动创建） |
| `DB_DRIVER` | 自动推断 | `sqlite`（默认）/ `postgres`；设了 `DATABASE_URL` 则自动用 postgres |
| `DATABASE_URL` | 空 | PostgreSQL 连接串，设置即启用 PostgreSQL |
| `PG_POOL_MAX` | `10` | PostgreSQL 连接池大小 |
| `PGSSL` | 空 | 设为 `require` 时启用 SSL（托管库常用） |
| `TRACKFOLIO_ADMIN_MAX_FAILED_ATTEMPTS` | `5` | 后台密码连续错误多少次后临时锁定 |
| `TRACKFOLIO_ADMIN_LOCK_MINUTES` | `15` | 后台密码错误过多后的锁定分钟数 |
| `TRACKFOLIO_PROVIDER` | `auto` | 行情源 `auto` / `sina` / `yahoo` |
| `TRACKFOLIO_FX_PROVIDER` | 跟随后台设置 | 汇率源 `auto` / `exchangerate` / `yahoo` / `mock` |

> 前端 web 没有运行时环境变量：API 走相对路径 `/api`，由反向代理转发到后端。

### 生产构建与启动

```bash
npm run build                       # 编译 server→dist、web→dist
# 后端（按需带上环境变量，或用 node --env-file=.env）
node --env-file=.env server/dist/index.js
# 前端 web/dist 为纯静态文件，交给 Nginx 等静态服务器托管，并把 /api 反代到后端
```

Nginx 反代示意：

```nginx
server {
  listen 80;
  root /var/www/trackfolio/web/dist;       # 前端静态文件
  location / { try_files $uri /index.html; }
  location /api/ {
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:5174;
  }
}
```

### Docker Compose 示意（PostgreSQL）

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: trackfolio
      POSTGRES_PASSWORD: change-me
      POSTGRES_DB: trackfolio
    volumes: [pgdata:/var/lib/postgresql/data]
  server:
    build: ./server
    environment:
      DATABASE_URL: postgres://trackfolio:change-me@db:5432/trackfolio
      PORT: "5174"
    depends_on: [db]
    ports: ["5174:5174"]
volumes:
  pgdata:
```

### 公网部署安全提醒

- 默认后台密码为 `admin`，公网部署前请**立即修改密码**。
- 后台保护采用单人自托管轻量方案：密码 hash + salt 存储，解锁后仅当前浏览器持有 30 分钟 token；服务端只保存 token hash，后台写接口需要 `X-Admin-Token`，并校验 `Origin` / `Referer` 来源。
- 连续输错后台密码会临时锁定；修改后台密码会撤销所有已解锁浏览器会话。
- 公网部署建议使用 HTTPS，并把前端静态文件与 `/api` 放在同一个域名下，通过可信反向代理转发到后端。该方案不是企业级多用户认证系统。

## 默认后台密码

首次初始化数据库时，后台默认密码为：

```text
admin
```

进入后台后建议立即修改密码。
