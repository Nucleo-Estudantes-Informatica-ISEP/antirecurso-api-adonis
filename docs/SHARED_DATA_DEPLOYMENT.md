# Antirecurso shared-data deployment

Status on 24 September 2026: development runs on shared PostgreSQL and MinIO. [API #106](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso-api-adonis/pull/106) and [web #186](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso/pull/186) merged into `dev`. Draft reviewed `dev` → `main` promotions [API #107](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso-api-adonis/pull/107) and [web #187](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso/pull/187) await approval and merge. Production still uses its old Supabase service. No backup setup or write freeze was used, per user request.

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

Preserve all other API values from the private environment file. Web has no new variable. Preserve its existing runtime values. `NEXT_PUBLIC_BASE_URL` is a build-time value and must keep its current route; the protected BFF route is fixed at `/api/protected`. `API_BASE_URL` and AuthNEI secrets remain runtime. S3 credentials never enter a web build or browser.

## Development — completed

- Coolify API `n720pqanpld76hs83cfiph9q` and web `k6voaig2rin9tjbcmxve7lnf` run merged `dev` revisions `a14a56d` and `d9eb8b4`. API retained Compose location `/compose.yml`, joined external network `gbheij1ljds8nrhfgdf9teeo`, and received `api-dev.env`; web received `web-dev.env`. Both applications have auto deployments enabled again.
- Pre-switch source and target matched across 19 tables, with one user and zero logical Storage objects. Source migration `id,name,batch` rows matched; new app migration ran in target, raising its migration count from 19 to 20. Running API reports `antirecurso_dev.antirecurso` as `antirecurso_dev_runtime`, bucket `antirecurso-dev-notes`, `RUN_MIGRATIONS=false`, no `DB_MIGRATION_URL`, and no Supabase variables. Runtime role cannot create schema objects.
- User confirmed live authenticated dev flow works. Web and API HTTP routes returned 200; anonymous protected route returned 401, anonymous private S3 object returned 403, and dev S3 identity could not list production bucket. Test note/object records were absent in final counts. After retirement, scoped S3 put/get/delete and application health passed again.
- Deleted old dev service `ku1xccoddzlol2fverxgfnpv`, its 14 Supabase containers (including Auth, Realtime, PostgREST, Studio, Analytics/Logflare, Vector and Storage), network `ku1xccoddzlol2fverxgfnpv`, service directory `/data/coolify/services/ku1xccoddzlol2fverxgfnpv`, and exact named volumes `ku1xccoddzlol2fverxgfnpv_deno-cache`, `ku1xccoddzlol2fverxgfnpv_supabase-db-config`, `ku1xccoddzlol2fverxgfnpv_supabase-db-data`. Deleting source volumes ended direct rollback to dev Supabase.

## Production

1. After development passes, review a `dev` → `main` promotion PR in each repository. The API's existing dev branch includes migration `1790000000000_remove_local_auth_fields`; the implementation PR changes it to retain production's 283 legacy `password_reset_codes` rows while removing unused user auth columns. Verify those rows remain after migration. Do not bypass required review.
2. Recheck production source immediately before switch. Staged copy currently has 19 matching app tables and 891,191 rows. Copy any new source changes and repeat row fingerprints, sequence, migration, and logical file checks. One source logical object, `RCOMP.pdf`, was copied with 2,754,323 bytes, `application/pdf`, and SHA-256 `f8f3b25659ed6c71eacdd8c7fe083368461603ab09ad18fa7d4a10b2a2d1d5ae`.
3. In Coolify API `z4eyxsfkuk2xmdw0hyauncy5`, keep `/compose.yml`; apply `api-prod.env` and remove SUPABASE variables. Preserve web `fwv5qhmkgez0xsigjg84sbzd` settings from `web-prod.env`. Keep auto deployment disabled while configuring.
4. Deploy reviewed API `main` with migrator, verify running DB `antirecurso_prod`, schema `antirecurso`, restricted runtime role, bucket `antirecurso-prod-notes`, migration status and health. Then deploy reviewed web `main` and run the same functional/security checks as dev. Set `RUN_MIGRATIONS=false`, remove `DB_MIGRATION_URL`, and re-enable both auto deployments after checks.
5. Once all intended source data/files and running dependencies are verified, remove only Supabase service `t4kck0w4w4kg404w84swc0o8`, its exact volumes and storage bind mount; verify application health and file access again. No shared, Orbit, or Fallstack resource may be removed.

Production source already has 12 notes (IDs 17, 19–29) whose upload IDs have no logical Storage object; authenticated Supabase Storage requests return `Object not found`. Their DB rows are preserved, but those historic downloads cannot pass until source files are supplied. Sixteen notes have direct URLs; none point to Supabase. This issue predates migration.

Rollback while an old stack exists: restore its prior Coolify API variables and prior reviewed application revision, redeploy API then web, and reconcile any writes made to shared services first. After source volumes are removed, direct rollback to old services is unavailable. Backups and write freezes were excluded at user request.
