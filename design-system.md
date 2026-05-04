# 个人工作站 - 设计系统规范 v2.0

## 设计原则

### 核心原则
1. **专注高效**: 传达"这是给实干家用的效率工具"的感觉
2. **现代极简**: 干净、留白、呼吸感
3. **一致性优先**: 全页面视觉语言 100% 统一
4. **层级清晰**: 通过颜色、尺寸、间距建立视觉层级
5. **交互反馈**: 所有可交互元素必须有 hover/active/focus 态
6. **双模式适配**: 浅色/深色模式对比度符合 WCAG AA 标准

---

## 字体系统

### 字体选择
| 用途 | 字体 | 重量 | 说明 |
|------|------|------|------|
| Display/Hero | Satoshi | 600-700 | 页面标题、模块标题。几何感强，现代但不平庸 |
| Body/UI | DM Sans | 400-500 | 正文、按钮、标签。可读性好，比 Inter 更有辨识度 |
| Data/Tables | Geist Mono | 400-500 | 数据展示、时间戳、金额。等宽对齐 |
| Code | Geist Mono | 400 | 代码块 |

### 字体加载
```html
<link href="https://fonts.googleapis.com/css2?family=Satoshi:wght@400;500;600;700&family=DM+Sans:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### 字号层级
| Token | 字号 | 行高 | 用途 |
|-------|------|------|------|
| text-xs | 12px | 1.5 | 辅助信息、标签 |
| text-sm | 14px | 1.5 | 正文、按钮 |
| text-base | 14px | 1.5 | 默认正文 |
| text-lg | 16px | 1.5 | 小标题 |
| text-xl | 18px | 1.3 | 模块标题 |
| text-2xl | 20px | 1.2 | 页面标题 |
| text-3xl | 24px | 1.2 | 大标题 |
| text-4xl | 28px | 1.1 | 数据展示 |

### 字重
| Token | 值 | 用途 |
|-------|-----|------|
| font-normal | 400 | 正文 |
| font-medium | 500 | 标签、按钮 |
| font-semibold | 600 | 小标题 |
| font-bold | 700 | 页面标题、数据 |

---

## 色彩系统

### 品牌主色 (Primary)
| 用途 | 浅色模式 | 深色模式 |
|------|----------|----------|
| Primary | `#2563EB` | `#3B82F6` |
| Primary Hover | `#1D4ED8` | `#60A5FA` |
| Primary Light | `#DBEAFE` | `#1E3A5F` |

### 语义色
| 类型 | 浅色 | 深色 | 用途 |
|------|------|------|------|
| Success | `#16A34A` | `#22C55E` | 成功/收入/完成 |
| Success Light | `#DCFCE7` | `#14532D` | 成功背景 |
| Warning | `#EA580C` | `#F97316` | 警告/待办/中等优先级 |
| Warning Light | `#FFF7ED` | `#431407` | 警告背景 |
| Error | `#DC2626` | `#EF4444` | 错误/支出/删除 |
| Error Light | `#FEF2F2` | `#450A0A` | 错误背景 |
| Info | `#2563EB` | `#3B82F6` | 信息提示 |

### 背景层级 (关键)
| 层级 | 浅色 | 深色 | 用途 |
|------|------|------|------|
| bg-primary | `#FFFFFF` | `#0A0A0A` | 页面背景 |
| bg-secondary | `#FAFAFA` | `#171717` | 次级表面/模块背景 |
| bg-tertiary | `#F5F5F5` | `#262626` | hover/输入框背景 |
| bg-card | `#FFFFFF` | `#1A1A1A` | 卡片背景 |
| bg-elevated | `#FFFFFF` | `#262626` | 弹窗/下拉菜单 |

### 文字层级
| 类型 | 浅色 | 深色 | 对比度 |
|------|------|------|--------|
| text-primary | `#171717` | `#FAFAFA` | >12:1 |
| text-secondary | `#525252` | `#D4D4D4` | >7:1 |
| text-muted | `#A3A3A3` | `#737373` | >4.5:1 |

### 边框
| 类型 | 浅色 | 深色 |
|------|------|------|
| border-primary | `#E5E5E5` | `#2A2A2A` |
| border-secondary | `#D4D4D4` | `#404040` |

---

## 间距系统 (8dp 规范)

| Token | 值 | 用途 |
|-------|-----|------|
| spacing-2xs | 4px | 图标与文字间距 |
| spacing-xs | 8px | 元素内部间距 |
| spacing-sm | 12px | 小组件间距 |
| spacing-md | 16px | 卡片内边距 |
| spacing-lg | 24px | 模块间距 |
| spacing-xl | 32px | 页面边距 |
| spacing-2xl | 48px | 大模块间距 |

---

## 圆角系统

| Token | 值 | 用途 |
|-------|-----|------|
| radius-sm | 6px | 按钮、输入框、小标签 |
| radius-md | 10px | 小卡片、图标容器 |
| radius-lg | 14px | 卡片、弹窗 |
| radius-xl | 20px | 大卡片、页面容器 |
| radius-full | 9999px | 圆形头像、徽章 |

---

## 阴影系统

### 浅色模式
| Token | 值 | 用途 |
|-------|-----|------|
| shadow-sm | `0 1px 2px rgba(0,0,0,0.04)` | 轻微浮起 |
| shadow-md | `0 2px 8px rgba(0,0,0,0.06)` | 卡片默认 |
| shadow-lg | `0 4px 16px rgba(0,0,0,0.08)` | hover态 |

### 深色模式
| Token | 值 | 用途 |
|-------|-----|------|
| shadow-sm | `0 1px 2px rgba(0,0,0,0.2)` | 轻微浮起 |
| shadow-md | `0 2px 8px rgba(0,0,0,0.3)` | 卡片默认 |
| shadow-lg | `0 4px 16px rgba(0,0,0,0.4)` | hover态 |

---

## 图标规范

### 图标库
- **统一使用 Lucide React** (线性图标)
- **尺寸规范**:
  - icon-xs: 14px (按钮内、标签)
  - icon-sm: 16px (导航、列表)
  - icon-md: 20px (卡片标题)
  - icon-lg: 24px (页面标题)

### 图标颜色
| 场景 | 浅色 | 深色 |
|------|------|------|
| 默认 | `text-secondary` | `text-secondary` |
| 主色 | `text-primary` | `text-primary-400` |
| 成功 | `text-success` | `text-success-400` |
| 警告 | `text-warning` | `text-warning-400` |
| 错误 | `text-error` | `text-error-400` |

---

## 组件规范

### 页面头部
```
结构: [图标容器(48x48)] + [标题(Satoshi 28px semibold)] + [副标题(text-sm muted)]
间距: gap-4, mb-10
图标容器: w-12 h-12 bg-primary rounded-[10px] flex items-center justify-center
图标: w-5 h-5 text-white
```

### 卡片组件
```
默认样式:
  bg-bg-card
  border border-border-primary
  rounded-[14px]
  shadow-md
  p-6

hover样式:
  shadow-lg
  border-border-secondary
  -translate-y-0.5
  transition-all duration-150
```

### 统计卡片
```
结构: [图标容器(44x44)] + [标签] + [数值(Geist Mono 32px)] + [趋势]
图标容器: w-11 h-11 rounded-[10px] bg-{status}/10 flex items-center justify-center
数值: font-mono text-3xl font-semibold
```

### 按钮组件
```
Primary:
  bg-primary text-white
  hover:bg-primary-hover
  px-4.5 py-2.5 rounded-[6px] font-medium
  transition-all duration-150
  hover:-translate-y-px

Secondary:
  bg-bg-card border border-border-primary
  text-text-primary
  hover:bg-bg-tertiary hover:border-border-secondary

Ghost:
  text-primary hover:bg-primary-light
  dark:text-primary-400 dark:hover:bg-primary/20

Danger:
  bg-error text-white
  hover:bg-error-dark
```

### 输入框组件
```
默认:
  w-full px-4 py-3
  border border-border-primary rounded-[6px]
  bg-bg-card text-text-primary
  focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary
  placeholder:text-text-muted
  transition-all duration-150

错误态:
  border-error focus:ring-error/20 focus:border-error
```

### 空状态组件
```
图标容器: w-16 h-16 rounded-full bg-bg-tertiary flex items-center justify-center
图标: w-7 h-7 text-text-muted
标题: text-sm font-medium text-text-secondary mb-1
描述: text-[13px] text-text-muted mb-4
操作按钮: Button variant="primary" size="sm"
```

---

## 交互规范

### hover 态
- 卡片: 阴影增强 + 边框变色 + 微上移(-2px)
- 按钮: 背景色变化 + 微上移(-1px)
- 输入框: 边框变色

### active 态
- 按钮: 背色更深 + scale(0.98)
- 卡片: 阴影减弱

### focus 态
- 所有可交互元素: ring-2 ring-primary/20
- 输入框: border-primary

### 禁用态
- opacity: 0.5
- cursor: not-allowed
- 移除所有交互效果

---

## 动画规范

### 过渡时长 (比之前更快)
| 类型 | 时长 | 用途 |
|------|------|------|
| micro | 100ms | 颜色变化、图标旋转 |
| short | 150ms | hover/状态切换 |
| medium | 250ms | 弹窗/页面切换 |

### 缓动函数
- 进入: ease-out
- 退出: ease-in
- 弹性: spring( stiffness: 500, damping: 30 )

### 动画类型
- 页面进入: fade-in + y:-16 → y:0 (duration: 250ms)
- 卡片列表: stagger( delay: index * 0.04 )
- 弹窗: scale(0.95) → scale(1) + fade (duration: 150ms)

---

## 响应式断点

| 断点 | 宽度 | 用途 |
|------|------|------|
| sm | 640px | 大手机 |
| md | 768px | 平板 |
| lg | 1024px | 小桌面 |
| xl | 1280px | 大桌面 |

### 页面边距
| 断点 | 边距 |
|------|------|
| mobile | p-4 |
| desktop | md:p-8 |

### 最大宽度
| 页面类型 | max-width |
|----------|-----------|
| Dashboard | 7xl (1280px) |
| Tasks | 4xl (896px) |
| Finance | 7xl (1280px) |
| Tools | 4xl (896px) |
| Settings | 6xl (1152px) |

---

## 更新日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-03 | v2.1 | 移除知识库模块，简化应用结构 |
| 2026-05-02 | v2.0 | 全面升级设计系统：字体改为 Satoshi+DM Sans+Geist Mono，主色调整为 #2563EB，优化动画时长，统一圆角和阴影系统 |
| 2026-05-01 | v1.0 | 初始设计系统创建 |
