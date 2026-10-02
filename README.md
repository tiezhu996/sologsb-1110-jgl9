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
│       ├── types/             # wood-board / sound-chamber / lacquer-layer / stringing（+ ui.ts / draft.ts）
│       ├── stores/            # board / chamber / lacquer / stringing（正式档案）+ draftStore（页签草稿）
│       ├── components/common/ # DimensionChart / LayerStack / ToneTextEditor / FilterBar / StatBadge / ProcessTimeline / EmptyPanel / ConflictDialog / DraftInbox
│       ├── hooks/             # useGuqinFilter / useStageProgress / useFormDraft / useArchiveSync
│       ├── pages/             # WorkshopBoard / BoardList / ChamberEditor / LacquerLedger / StringingLog（+ NotFound）
│       ├── router/index.ts    # 路由表
│       └── utils/             # layer / db / export / conflict / forms / archive / bus / tab（+ wood / seed / id / plain）
│   └── scripts/verify-conflicts.ts # 并发版本核对的事务级验证（npm run verify:conflicts）
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

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbguqin-db`），表：`boards`、`chambers`、`lacquers`、`stringings`（四张正式工序档案表）、`drafts`（页签工序草稿）、`meta`。
- **正式档案与草稿分开保存**：四个登记弹窗里的填写内容只写入 `drafts` 表，按浏览器页签（tabId）隔离——同机两个页签同编同一张琴互不覆盖，刷新本页签可恢复，顶栏「本页签草稿」可继续编辑或丢弃；只有点「提交到正式档案」且通过版本核对后才写入四张正式表。
- **提交版本核对（乐观锁）**：每条正式档案带 `rev` 版本号，提交时按页面打开时的版本做三向比对：双方改不同字段自动合并；同一字段都改且改得不同才弹冲突核对，列出「打开时值 / 对方页签已保存 / 本页签草稿」，逐项选择采用方后可重试；记录被另一页签删除、槽腹/上弦改填的琴号已被占用也会拦截。核对在 Dexie 事务内完成，写入失败时正式档案回滚、草稿原样保留，可重试。
- 另一个页签提交成功后，本页签经 BroadcastChannel 自动重新装载正式档案（跨浏览器/跨设备仍各自独立，纯本地无后端）。
- **首页进度、导出备份、荫房异常等统计只认四张正式表**，`drafts` 不进备份、不进统计。
- `db.version(1)` 建表声明索引；`db.version(2)` 为髹漆表增加 `[guqinNo+seq]` 复合索引并回填历史厚度；`db.version(3)` 为四张正式表增加 `rev/updatedAt`、新增 `drafts` 表，旧数据按初版 `rev=1` 兼容，旧版 JSON 备份恢复时同样自动补版。升级前可用顶栏「导出备份」导出全量 JSON。
- 并发核对可用 `npm run verify:conflicts`（基于 fake-indexeddb 的事务级验证）回归。
- 首次打开且表为空时写入一批示例工序档案（`src/utils/seed.ts`）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
