# PLIEGO contributor guidance

Follow the repository rules in [AGENTS.md](AGENTS.md). The approved baseline documents and Flyway ZIP at the repository root remain authoritative.

Keep all human-facing REST error and validation feedback in Spanish while preserving stable machine-readable codes and SQLSTATE mappings.

For PLIEGO frontend visual work, read [docs/design/PLIEGO_FRONTEND_DESIGN_LANGUAGE.md](docs/design/PLIEGO_FRONTEND_DESIGN_LANGUAGE.md) before changing UI.

For production deployment or rollback, use `/pliego-deploy` or read the canonical [.agents/skills/pliego-deploy/SKILL.md](.agents/skills/pliego-deploy/SKILL.md) and [production runbook](docs/deployment/production-runbook.md). These instructions preserve the user's authorization; reading them does not grant permission to mutate production.
