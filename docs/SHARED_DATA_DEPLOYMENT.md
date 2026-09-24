# Antirecurso shared-data deployment

Status: implementation and dev/prod data copies staged on 24 September 2026. No Antirecurso application has switched yet. Review and deployment checks below remain required.

Review [API PR #106](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso-api-adonis/pull/106) and [web PR #186](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso/pull/186) into `dev`. Required reviewer approvals and CI are pending. Production promotion PRs can be opened only after reviewed dev merges.

## Private configuration

Root-only files on the VPS: `/data/nei-shared/antirecurso-migration/api-dev.env`, `web-dev.env`, `api-prod.env`, and `web-prod.env` (mode 0600). Retrieve each privately, replacing `api-dev.env` as needed:

```sh
umask 077
ssh -o PasswordAuthentication=no -i ~/.ssh/ovh-dinis ubuntu@92.222.128.99 'sudo cat /data/nei-shared/antirecurso-migration/api-dev.env' > ./api-dev.env
```

Keep the local copy outside the repository; do not paste secrets into PRs or chat. API files preserve current AuthNEI, signing, CORS, limiter, and application keys. Web files preserve current AuthNEI settings. Development and production have different DB and S3 credentials.

| API variable | Scope | Action |
| --- | --- | --- |
| DB_URL | Runtime | Use environment's restricted runtime role. |
| DB_MIGRATION_URL | Runtime during first rollout only | Use environment's schema-owning migrator; remove after migrations. |
| DB_SCHEMA | Runtime | Set `antirecurso`. |
| DB_SSL | Runtime | Set `false` on private Docker network. |
| DB_SSL_REJECT_UNAUTHORIZED | Runtime | Set `true`; unused when SSL disabled. |
| S3_ENDPOINT | Runtime | Set `http://minio-gbheij1ljds8nrhfgdf9teeo:9000`. |
| S3_ACCESS_KEY, S3_SECRET_KEY | Runtime | Use environment's bucket-scoped identity. |
| S3_BUCKET | Runtime | Dev: `antirecurso-dev-notes`; prod: `antirecurso-prod-notes`. |
| SHARED_DATA_NETWORK | Compose interpolation | Set `gbheij1ljds8nrhfgdf9teeo`. |
| RUN_MIGRATIONS | Runtime | `true` for first rollout, then `false`. |
| SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET | Runtime | Remove after switching. |

Preserve all other API values from the private environment file. Web has no new variable. Preserve its existing runtime values. `NEXT_PUBLIC_BASE_URL` and `NEXT_PUBLIC_PROTECTED_API_BASE_URL` are build-time values and must keep their current same-origin routes; `API_BASE_URL` and AuthNEI secrets remain runtime. S3 credentials never enter a web build or browser.

## Development

1. Review and merge the API and web implementation PRs into `dev`. Both repositories require CI and code-owner review. Keep automatic deployment disabled until both applications have their new configuration.
2. In Coolify API application `n720pqanpld76hs83cfiph9q`, retain Compose location `/compose.yml`. Apply `api-dev.env`; remove the three SUPABASE variables. Compose attaches only this API to external network `gbheij1ljds8nrhfgdf9teeo`. Keep the web application `k6voaig2rin9tjbcmxve7lnf` on its existing Compose location and values in `web-dev.env`.
3. Compare current source and staged target table fingerprints, sequences, migration history, and logical file inventory. Refresh target from source if anything changed; no write freeze is needed. Dev source had 19 tables, 19 migration records, one user, and zero Storage objects at staging.
4. Deploy reviewed API `dev`. With `RUN_MIGRATIONS=true`, the entrypoint runs migrations as `antirecurso_dev_migrator`, then serves using `antirecurso_dev_runtime`. Confirm running container joins shared network, connects to `antirecurso_dev`, reports `current_schema()=antirecurso`, and has bucket `antirecurso-dev-notes`. Confirm migration status includes the pending dev migration. Then set `RUN_MIGRATIONS=false` and remove `DB_MIGRATION_URL` from Coolify and the running application at the next rollout.
5. Deploy reviewed web `dev`. Verify AuthNEI login, admin PDF upload, invalid PDF rejection, promotion, signed download, delete, study/exam/review flows, and anonymous object denial. Remove all test notes/files. Repeat DB/file comparison; re-enable auto deployments for both dev apps after successful checks.
6. Only then remove Supabase service `ku1xccoddzlol2fverxgfnpv` and its exact DB/config/cache volumes and storage bind mount. Verify web/API and file access again. Deleting source volumes ends direct rollback to old services.

## Production

1. After development passes, review a `dev` → `main` promotion PR in each repository. The API's existing dev branch includes migration `1790000000000_remove_local_auth_fields`; the implementation PR changes it to retain production's 283 legacy `password_reset_codes` rows while removing unused user auth columns. Verify those rows remain after migration. Do not bypass required review.
2. Recheck production source immediately before switch. Staged copy currently has 19 matching app tables and 891,191 rows. Copy any new source changes and repeat row fingerprints, sequence, migration, and logical file checks. One source logical object, `RCOMP.pdf`, was copied with 2,754,323 bytes, `application/pdf`, and SHA-256 `f8f3b25659ed6c71eacdd8c7fe083368461603ab09ad18fa7d4a10b2a2d1d5ae`.
3. In Coolify API `z4eyxsfkuk2xmdw0hyauncy5`, keep `/compose.yml`; apply `api-prod.env` and remove SUPABASE variables. Preserve web `fwv5qhmkgez0xsigjg84sbzd` settings from `web-prod.env`. Keep auto deployment disabled while configuring.
4. Deploy reviewed API `main` with migrator, verify running DB `antirecurso_prod`, schema `antirecurso`, restricted runtime role, bucket `antirecurso-prod-notes`, migration status and health. Then deploy reviewed web `main` and run the same functional/security checks as dev. Set `RUN_MIGRATIONS=false`, remove `DB_MIGRATION_URL`, and re-enable both auto deployments after checks.
5. Once all intended source data/files and running dependencies are verified, remove only Supabase service `t4kck0w4w4kg404w84swc0o8`, its exact volumes and storage bind mount; verify application health and file access again. No shared, Orbit, or Fallstack resource may be removed.

Production source already has 12 notes (IDs 17, 19–29) whose upload IDs have no logical Storage object; authenticated Supabase Storage requests return `Object not found`. Their DB rows are preserved, but those historic downloads cannot pass until source files are supplied. Sixteen notes have direct URLs; none point to Supabase. This issue predates migration.

Rollback while an old stack exists: restore its prior Coolify API variables and prior reviewed application revision, redeploy API then web, and reconcile any writes made to shared services first. After source volumes are removed, direct rollback to old services is unavailable. Backups and write freezes were excluded at user request.
