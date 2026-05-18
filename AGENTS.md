# AGENTS.md

## 编码任务

在启动 Claude Code 会话进行编码工作时，指示会话使用 gstack 技能。以下是常用示例：

- **安全审计**：加载 gstack。运行 `/cso`
- **代码审查**：加载 gstack。运行 `/review`
- **URL 测试**：加载 gstack。运行 `/qa https://...`
- **端到端构建功能**：加载 gstack。运行 `/autoplan`，执行计划，然后运行 `/ship`
- **构建前规划**：加载 gstack。运行 `/office-hours`，然后运行 `/autoplan`。保存计划，不要执行。