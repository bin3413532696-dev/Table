# Contributing to Table

Thank you for considering contributing! This document outlines the guidelines.

## Development Setup

See [README.md](./README.md#quick-start) for local development setup.

## Code Style

- **Frontend (TypeScript/React)**: 2-space indent, `PascalCase` for components, `camelCase` for utilities and hooks.
- **Backend (Python)**: PEP 8, 4-space indent, `snake_case` for modules and functions.
- **Database**: Prisma schema with `snake_case` table/column names mapped via `@map`.

## Before Submitting

1. Ensure TypeScript type-check passes: `npm run typecheck`
2. Run frontend API tests: `npm run test:frontend-api`
3. Run Python backend tests: `npm run backend:test`
4. Run relevant smoke tests for your changes

## Commit Convention

Use short, descriptive commit messages in Chinese or English, e.g.:
- `feat: 添加知识库高级筛选`
- `fix: 修复 agent SSE 断线重连`
- `chore: 更新依赖版本`

## Pull Request Process

1. Link related issues in the PR description
2. Include screenshots for UI changes
3. Include example request/response for API changes
4. Ensure CI passes before requesting review
