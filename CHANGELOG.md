# Changelog

## [Unreleased]

### Housekeeping
- Clean up development artifacts and add standard GitHub files

## [1.0.0] - 2026-06-02

### Added
- Python backend migration complete: FastAPI + SQLAlchemy + PostgreSQL
- Agent module with LangGraph integration and session memory
- RAG knowledge base with hybrid search, MMR reranking, cross-encoder reranking
- Query preprocessing with Chinese stopword removal and multi-query expansion
- Provider management with encrypted API key storage
- OCR document processing service
- Smoketest and e2e test suites for agent, RAG, knowledge, and modules

### Fixed
- P0 optimistic locking concurrency issue in task/finance updates
- Security vulnerabilities (12 issues): dependency upgrades, input validation, CSRF hardening
- Bootstrap provider auto-creation timing bug
- Settings data statistics inconsistency

### Changed
- Migrated agent architecture to LangGraph
- Unified frontend API layer to use HTTP client
- Removed legacy TypeScript backend (deprecated)
- Updated documentation and development standards
