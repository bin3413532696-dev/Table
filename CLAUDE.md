# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

- `npm run dev` — 启动开发服务器（webpack serve，端口 3266，支持热更新）
- `npm run build` — 生产构建到 `dist/` 目录
- `npm run typecheck` — 运行 TypeScript 类型检查（`tsc --noEmit`）

## 项目架构

中文界面的个人工作站单页应用。所有数据存储于浏览器 localStorage，无后端服务。

### 路由

使用 `HashRouter`，6 个页面共享 Layout（侧边栏 + 顶栏）：

| 路由 | 模块 |
|---|---|
| `/dashboard` | 首页仪表盘，聚合各模块统计 |
| `/notes` | Markdown 笔记编辑器，支持文件夹、标签、图谱 |
| `/tasks` | 任务管理，支持优先级和截止日期 |
| `/finance` | 收支统计（面向 LLM API 费用场景） |
| `/tools` | 计算器、取色器、JSON 格式化工具 |
| `/settings` | 个人资料、通知、安全、数据导入导出 |

### 数据层

`src/db/index.ts` — 基于 localStorage 的 CRUD 封装，4 个集合：

- **finance** — `FinanceRecord[]`，按模型统计收支
- **tasks** — `Task[]`，含优先级、截止日期、完成状态
- **notes** — `Note[]`，支持 Markdown 内容、标签、`[[双向链接]]`、反向链接
- **folders** — `Folder[]`，通过 `parentId` 实现嵌套文件夹

每个集合有独立的操作对象（`financeDB`、`taskDB`、`noteDB`、`folderDB`），共享 `dataManager` 提供全量导出/导入/清空功能。

### 笔记模块（核心复杂度）

`src/pages/Notes/` — 三栏布局（可拖拽调整宽度，可折叠）：

- **FileTree** — 递归文件夹树，支持右键菜单（重命名、删除、新建）
- **Editor** — CodeMirror 编辑器，支持 Markdown 语法高亮、Vim 模式（`@replit/codemirror-vim`）、编辑/分屏/预览三种模式、格式化工具栏、全屏
- **右侧面板** — 三个 Tab：反向链接（`[[链接]]` 的出链/入链）、标签云（点击筛选）、图谱视图（D3.js 力导向图）
- **CommandPalette** — ⌘K 命令面板，快速搜索和切换笔记/文件夹

### 关键依赖

- **UI**: React 18、Tailwind CSS、Framer Motion、Lucide React 图标
- **构建**: Webpack 5、Babel、TypeScript、PostCSS
- **笔记编辑**: CodeMirror、react-markdown、remark-gfm
- **图谱**: D3.js 力导向图
- **工具库**: date-fns、fuse.js、recharts
