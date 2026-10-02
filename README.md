# 古琴斫制工序记录台（gbguqin）

面向斫琴师与琴坊档案员：把面板底板材、槽腹尺寸、灰胎髹漆遍次与上弦记录串成可回溯的工序档案；音色评价只用文字填写，不做音频文件与波形处理。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21810>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| 构建 | Vite 6（`npm run build` 含 `vue-tsc --noEmit` 类型检查） |
| UI | Element Plus 2 |
| 路由 | Vue Router 4（5 条业务路由 + 404） |
| 状态 | Pinia（boardStore / chamberStore / lacquerStore / stringingStore） |
| 存储 | IndexedDB（Dexie，库名 `gbguqin-db`） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21810
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # wood-board / sound-chamber / lacquer-layer / stringing（+ ui.ts）
│       ├── stores/            # boardStore / chamberStore / lacquerStore / stringingStore
│       ├── components/common/ # DimensionChart / LayerStack / ToneTextEditor / FilterBar / StatBadge / ProcessTimeline / EmptyPanel
│       ├── hooks/             # useGuqinFilter / useStageProgress
│       ├── pages/             # WorkshopBoard / BoardList / ChamberEditor / LacquerLedger / StringingLog（+ NotFound）
│       ├── router/index.ts    # 路由表
│       └── utils/             # layer.ts / db.ts / export.ts（+ wood.ts / seed.ts / id.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 琴坯进度 | 选材/掏膛/灰胎/上弦四阶段统计、推进比、缺失项与工序动态 |
| `/boards` | 板材登记与配对 | 面板底板配对、含水率回显、厚度差、槽腹剖面标注 |
| `/chambers` | 槽腹尺寸记录 | 纳音/龙池/凤沼三处厚度、槽腹深度、天地柱与龙池凤沼尺寸，SVG 剖面标注 |
| `/lacquer` | 灰胎髹漆遍次 | 按遍次累加厚度、荫房温湿度窗口校验、层积条与养护天数 |
| `/stringing` | 上弦与音色评价 | 散音/按音/泛音三段纯文本评语、九德简述、缺陷标记与版本对照 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbguqin-db`），表：`boards`、`chambers`、`lacquers`、`stringings`、`drafts`、`meta`。
- **正式档案与草稿分存**：`boards/chambers/lacquers/stringings` 是正式工序档案，只有在编辑弹窗点「提交到正式档案」并通过版本核对后才会写入；`drafts` 是按页签隔离的工序草稿（主键 `tabId:kind:targetId`），两个页签各改各的草稿，互不覆盖。
- **并发提交（乐观锁）**：四类正式记录带 `version`，打开编辑时记录版本与字段快照；提交时以「打开时快照 / 本页签草稿 / 正式档案现值」三方核对——只一方改动直接采纳，双方改不同字段自动合并，双方同改同一字段才列为冲突，弹窗列出打开时/对方页签/本页签三方改动供逐字段选择。写入在单事务内复查，冲突或档案已被删时事务回滚：**正式档案不动、草稿保留，可修改后重试**。髹漆追加在提交时才按正式档案分配遍次，两页签同时追加各得一遍并自动重算累计厚度。
- 首页进度、顶栏「导出备份」、荫房超窗口/缺陷等异常统计只读取四张正式表，绝不读取草稿；备份 JSON 也不含草稿。顶栏草稿提示只统计本页签未提交草稿数。
- 正式档案通过 Dexie `liveQuery` 订阅：另一个页签提交后，本页签的台账与进度会刷新到最新版本（草稿不在订阅范围）。
- `db.version(1)` 建表；`version(2)` 为髹漆表增加 `[guqinNo+seq]` 复合索引并回填历史厚度；`version(3)` 增加 `drafts` 表，四类正式表增加 `version` 乐观锁字段，**旧数据按初版 version=1 自动兼容**，无需手工迁移。升级前可用顶栏「导出备份」导出全量 JSON（仅正式档案）。
- 首次打开且表为空时写入一批示例工序档案（`src/utils/seed.ts`）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
