# Data 目录规范

本目录用于存储应用的所有数据文件，支持双向同步：
- **页面修改** → 自动同步到本目录
- **本目录修改** → 自动同步到页面

## 目录结构

```
data/
├── config.json          # 全局配置（主题、语言等）
│
├── finance/             # 财务数据
│   ├── .gitkeep
│   └── finance.json     # 财务记录数组
│
├── tasks/               # 任务数据
│   ├── .gitkeep
│   └── tasks.json       # 任务记录数组
│
├── notes/               # 知识库笔记
│   ├── .gitkeep
│   ├── index.json       # 笔记索引（元数据）
│   └── *.md             # 笔记文件（Markdown + YAML frontmatter）
│
├── folders/             # 文件夹结构
│   ├── .gitkeep
│   └── folders.json     # 文件夹层级结构
│
└── backup/              # 数据备份
    ├── .gitkeep
    └── backup_YYYYMMDD.json  # 按日期备份
```

## 文件格式说明

### finance.json

```json
[
  {
    "id": "lxyz123-a1b2c3d-000",
    "type": "income",
    "amount": 100.00,
    "description": "描述",
    "category": "类别",
    "date": "2026-05-02",
    "model": ""
  }
]
```

### tasks.json

```json
[
  {
    "id": "lxyz123-a1b2c3d-001",
    "title": "任务标题",
    "completed": false,
    "createdAt": "2026-05-02T10:00:00.000Z",
    "priority": "medium",
    "dueDate": "2026-05-10"
  }
]
```

### notes/*.md

每个笔记使用 Markdown 格式，包含 YAML frontmatter：

```markdown
---
id: 550e8400-e29b-41d4
title: "笔记标题"
tags: ["技术", "学习"]
links: ["abc123-def456"]
backlinks: []
createdAt: 1715000000000
updatedAt: 1715100000000
---

笔记内容...
```

### index.json

笔记索引文件，包含所有笔记的元数据：

```json
[
  {
    "id": "550e8400-e29b-41d4",
    "title": "笔记标题",
    "tags": ["技术", "学习"],
    "createdAt": 1715000000000,
    "updatedAt": 1715100000000
  }
]
```

## 双向同步机制

### 页面 → 文件

- 用户在页面修改数据后，自动触发同步
- 同步延迟：2秒（防抖）
- API 端点：`POST /api/sync-data`

### 文件 → 页面

- 开发模式下监听文件变化（使用 chokidar）
- 文件修改后通知页面重新加载
- API 端点：`GET /api/load-data`

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sync-data` | POST | 同步数据到文件 |
| `/api/load-data` | GET | 从文件加载数据 |
| `/api/notes/:id` | GET | 加载单个笔记 |
| `/api/notes/:id` | POST | 保存单个笔记 |
| `/api/notes/:id` | DELETE | 删除笔记 |

## 注意事项

1. **不要手动修改正在同步的文件** - 可能导致数据冲突
2. **笔记文件命名规则** - ` sanitized_title + _ + id[0:8] + .md`
3. **备份文件** - 定期备份重要数据
4. **生产环境** - 双向同步仅在开发模式启用