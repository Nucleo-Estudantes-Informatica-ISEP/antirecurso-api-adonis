# Antirecurso shared-data deployment

Status: **development and production completed on 24 September 2026**. Both API and web applications run on the NEI shared PostgreSQL and MinIO services. Both old Antirecurso Supabase stacks and their exact obsolete volumes were deleted. All four Coolify applications are healthy and auto deployments are enabled. Backup setup and write freezes were excluded at the user's request.

Reviewed implementation PRs: [API dev #106](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso-api-adonis/pull/106), [web dev #186](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso/pull/186), [API conflict fix #109](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso-api-adonis/pull/109), [API dev to main #107](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso-api-adonis/pull/107), [web dev to main #187](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso/pull/187). All merged. No implementation PR remains to merge.

## Private environment files

Complete, separate files are on the VPS at `/data/nei-shared/antirecurso-migration/`: `api-dev.env`, `web-dev.env`, `api-prod.env`, `web-prod.env`. They are root-readable only (mode 0600). Retrieve each privately from your machine, outside any Git checkout:

```sh
umask 077
mkdir -p "$HOME/antirecurso-private-env"
for name in api-dev web-dev api-prod web-prod; do
  ssh -o PasswordAuthentication=no -i ~/.ssh/ovh-dinis ubuntu@92.222.128.99 \
    "sudo cat /data/nei-shared/antirecurso-migration/$name.env" \
    > "$HOME/antirecurso-private-env/$name.env"
done
```

Never paste these files into chat or a PR. API files retain `APP_KEY`, AuthNEI/ZITADEL, CORS, limiter and session settings. Web files retain AuthNEI client and signing settings. Dev and production use different DB and S3 credentials.

| Setting | Scope | Current value or action |
| --- | --- | --- |
| `DB_URL` | API runtime | Environment's restricted `antirecurso_*_runtime` connection to shared PostgreSQL. |
| `DB_SCHEMA` | API runtime | `antirecurso`. |
| `DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED` | API runtime | `false`, `true`; private Docker network has SSL disabled. |
| `S3_ENDPOINT` | API runtime | `http://minio-gbheij1ljds8nrhfgdf9teeo:9000`. |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | API runtime | Environment's bucket-scoped identity. Never put these in web variables or browser code. |
| `S3_BUCKET` | API runtime | Dev `antirecurso-dev-notes`; production `antirecurso-prod-notes`. Both private. |
| `SHARED_DATA_NETWORK` | API Compose interpolation | `gbheij1ljds8nrhfgdf9teeo`. |
| `RUN_MIGRATIONS` | API runtime | `false` after one-time migration; currently `false` in both environments. |
| `DB_MIGRATION_URL` | API runtime during migration only | Schema-owning migrator connection was used for first deployment. Now empty/removed; never expose it to the running API. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | Old API runtime | Removed. |
| `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_PROTECTED_API_BASE_URL` | Web build time and runtime | Use the environment-specific values in its web file. Rebuild web after changing either. |
| `API_BASE_URL`, AuthNEI variables | Web runtime | Preserve environment-specific values in its web file. |
| `NODE_ENV` | Web runtime | `production`; do not set as a Coolify build-time variable, because pnpm otherwise omits required Tailwind build dependencies. |

Both repositories deploy from `/compose.yml`. API Compose joins existing external network `gbheij1ljds8nrhfgdf9teeo`; web Compose needs no shared-data network change. No shared service Compose edit was needed. The shared PostgreSQL host is `postgres-gbheij1ljds8nrhfgdf9teeo:5432`.

## Development deployment — completed

1. Reviewed API #106 and web #186 merged into `dev`. Auto deployment was held until Coolify variables and shared-data network were ready.
2. Coolify API `n720pqanpld76hs83cfiph9q` and web `k6voaig2rin9tjbcmxve7lnf` received their respective `api-dev.env` and `web-dev.env` values. API used the `antirecurso_dev` DB, `antirecurso` schema, and `antirecurso-dev-notes` bucket. API `dev` deployed before web `dev`.
3. Source app tables and Adonis migration history were copied; logical Supabase Storage was empty. Schema migrator ran once, then `RUN_MIGRATIONS=false` and the migrator URL was removed from the API runtime.
4. Counts of all 19 app tables matched source. Authenticated dev flows passed per user, as did public 200/protected 401, private-object 403, S3 put/get/delete and cross-bucket denial. Temporary test data was removed.
5. Old service `ku1xccoddzlol2fverxgfnpv`, its 14 stack containers (including Auth, Realtime, PostgREST, Studio, Storage, Analytics/Logflare and Vector), network, route, and `/data/coolify/services/ku1xccoddzlol2fverxgfnpv` directory were removed. Deleted exact volumes: `ku1xccoddzlol2fverxgfnpv_deno-cache`, `ku1xccoddzlol2fverxgfnpv_supabase-db-config`, `ku1xccoddzlol2fverxgfnpv_supabase-db-data`. Post-retirement health and S3 put/get/delete passed. Auto deployments are enabled.

Running revisions: API `a14a56d`, web `d9eb8b4`. Direct rollback to old dev Supabase ended when its volumes were deleted.

## Production deployment — completed

1. Reviewed API #109 resolved newer AuthNEI changes, then reviewed API #107 and web #187 promoted `dev` into `main`. Production auto deployments stayed disabled while configuration and data refresh finished.
2. Coolify API `z4eyxsfkuk2xmdw0hyauncy5` and web `fwv5qhmkgez0xsigjg84sbzd` received `api-prod.env` and `web-prod.env`. API uses `antirecurso_prod.antirecurso` as `antirecurso_prod_runtime` and private bucket `antirecurso-prod-notes`. API `main` deployed before web `main`.
3. Source changes after staging (two users, one pending-account row, one exam-state row, two note updates) were reconciled before deployment. All 19 table counts and ordered row SHA-256 streams matched immediately before cutover (891,195 rows total), as did all 17 sequence values. The one-time migration added the 20th Adonis migration record and removed legacy user auth columns. The API then ran with `RUN_MIGRATIONS=false` and no usable migrator URL.
4. Supabase RLS copied with the app tables denied access to the restricted runtime role; RLS was disabled **only** on the 19 target app tables. Runtime then read 1,952 users, 20 migrations and 283 retained password-reset records. Runtime lacks schema CREATE and dev DB access. The production web build required `NODE_ENV` to be runtime-only.
5. User confirmed authenticated production login, PDF upload, invalid-PDF rejection, promotion, signed download, deletion, and study/exam/review passed. Final source/target check found 17 unchanged tables byte-equivalent by ordered CSV SHA-256; users matched on all retained columns. The extra target migration and two advanced sequences reflected the schema change and cleaned-up smoke tests. No test rows/files remained.
6. Source bucket `notes` and target bucket `antirecurso-prod-notes` each held `RCOMP.pdf`: 2,754,323 bytes, `application/pdf`, SHA-256 `f8f3b25659ed6c71eacdd8c7fe083368461603ab09ad18fa7d4a10b2a2d1d5ae`. Twelve note rows (IDs 17, 19–29) already lacked files at source and were preserved. Sixteen note URLs point to external SharePoint/Drive resources; none points to Supabase. No production app or old-service scheduled tasks used Supabase.
7. Old service `t4kck0w4w4kg404w84swc0o8`, its Auth, Realtime, PostgREST, Studio, Storage, Vector, and other stack containers, route, network, and `/data/coolify/services/t4kck0w4w4kg404w84swc0o8` directory were removed. Coolify's deletion job left stopped containers and volumes, so those exact resources were removed manually. Deleted volumes: `t4kck0w4w4kg404w84swc0o8_supabase-db-config` and `t4kck0w4w4kg404w84swc0o8_supabase-db-data`.
8. After retirement, web/API/public subjects returned HTTP 200, protected API returned 401, anonymous private S3 read returned 403, and authorized read of `RCOMP.pdf` still matched SHA-256. API/web and shared PostgreSQL/MinIO containers were healthy. Production auto deployments are enabled.

Running revisions: API `2f344716`, web `7bcb7df0`. Deleting the production source volumes ended direct rollback to old Supabase. For future application rollback, deploy a reviewed earlier application revision against the shared services and reconcile any data written since that revision; the deleted source stack cannot serve as a rollback target. No deployment or configuration step remains for the user.
