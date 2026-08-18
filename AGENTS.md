# AGENTS.md

Engineering instructions for the current Antirecurso backend. This AdonisJS repository replaces the discontinued Laravel API; do not copy behavior or deployment assumptions from the old backend.

## Workflow and tests

- Branch from `main`, use a conventional branch prefix, Conventional Commits, and one logical commit per issue when practical.
- Put `Closes #N` in the PR body only when the issue is fully resolved. Preserve useful work and close superseded PRs so reviewers have one path.
- Prefer TDD for security boundaries, authorization/ownership, validators, transactions, exam state, rate limiting, and services: write a focused failing Japa test, implement the smallest correction, then refactor green. If a hosted Storage behavior cannot be deterministic locally, add the closest service/API regression and document the staging verification.
- Every bug/security fix requires regression coverage. Never make CI green by weakening lint, types, tests, migrations, builds, or scans.

## Required verification

```bash
npm ci
npm run lint
npm run typecheck
npm test
node ace migration:run --force
npm run build
npm audit --omit=dev
docker build -t antirecurso-api-check .
```

Use an isolated test database for migrations and API/integration tests. Never run production migrations, seeds, or destructive checks without explicit authorization and a backup.

## CI/CD

`.github/workflows/ci.yml` requires frozen install, lint, typecheck, Japa tests, migrations against isolated PostgreSQL, production build/audit, non-root Docker build, and Gitleaks for every PR to `main`.

Deployment is a reviewed `main` image rollout. `RUN_MIGRATIONS=true` makes the entrypoint apply migrations before serving; verify the migration result before web traffic. Health is `GET /`. For cross-repository contract changes, deploy and smoke this API before the Antirecurso web PR.

Production must configure exact `CORS_ALLOWED_ORIGINS`, issuer/audiences, the shared database limiter, and Supabase Storage credentials/policies. Actor/owner identity comes from the validated token, never request input. Stored note promotion validates object size, type, and PDF signature.

Dependabot routine groups are patch/minor only. Adonis 7, Node Current, TypeScript 7, ESLint 10, or other majors require a dedicated migration PR and compatibility matrix.

## Documentation

Keep `README.md`, `.env.example`, `docs/API.md`, `docs/DATABASE_SCHEMA.md`, migrations, and this file synchronized. Remove “auth TODO”, public detailed-exam-review, wildcard-CORS, old migration counts, retired Laravel, and starter deployment guidance when encountered.
