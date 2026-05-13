# 修复 GitHub Issue

目标：分析并修复指定的 GitHub Issue：`$ARGUMENTS`

## 建议流程

1. 使用 `gh issue view <issue-number>` 查看问题详情。
2. 提炼复现条件、期望行为和影响范围。
3. 在仓库中搜索相关模块、接口、状态流和测试。
4. 以最小改动完成修复，避免顺带重构无关代码。
5. 补充或更新测试，覆盖问题对应的回归场景。
6. 运行与改动相关的校验命令。
7. 使用清晰的 Conventional Commit 提交信息。
8. 如需要，再推送分支并创建 PR。

## 常用检查命令

```powershell
npm run typecheck
npm run server:typecheck
npm run build
```

按改动范围补充执行：

```powershell
npm run knowledge:smoke
npm run knowledge:e2e
npm run agent:modules:e2e
```

## 执行要求

- GitHub 相关操作优先使用 `gh`
- 修复前先确认问题对应模块的现有行为
- 若无法稳定复现，至少补充能覆盖根因的测试或断言
