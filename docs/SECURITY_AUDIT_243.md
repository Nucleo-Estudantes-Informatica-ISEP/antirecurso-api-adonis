# Antirecurso Adonis API security audit

The audit covered API `dev` at `c18d03d28f009423528fb95b12d954955e1021ab` and web `dev` at `7c6fcf3b14d5a88287b4bc500091b3f5961ce4c0` for [web #243](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso/issues/243). The routes below are relative to the Adonis HTTP server. Production ingress may expose them under `/api/backend`.

## Route inventory

The matrix records every explicit method and path in [start/routes.ts](../start/routes.ts). The server stack adds request logging, CORS, dependency bindings and static middleware. Registered routes also use the body parser. There is no tracked public static tree in this revision. Framework HEAD behavior and CORS preflight derive from these routes and the server stack.

| Method and route | Intended access and enforcement reviewed |
| --- | --- |
| `GET /` | Public health response with a fixed status. |
| `GET /subjects`, `GET /subjects/:id` | Public published catalogue. The optional question presence filter is a fixed ORM predicate. |
| `GET /subjects/:id/stats` | Authenticated. Statistics scoped to the current user and requested subject. |
| `GET /subjects/:id/scoreboard/:mode` | Public. Visible score records only, with mode constrained by query logic. |
| `POST /subjects/:id/scoreboard` | Owner by session. Only the actor's visibility setting changes. |
| `GET /comments`, `GET /comments/:id` | Authenticated. Excludes hidden comments and the viewer's blocked users. |
| `POST /comments` | Authenticated, throttled. Comment author comes from the session. |
| `POST /comments/:id/report` | Authenticated, throttled. The comment must be visible to the reporter, who cannot report their own comment. |
| `GET /comment-reports`, `POST /comment-reports/:id/review` | Admin. The review mutation is throttled and records the actor. |
| `GET /questions/:id` | Public question and option content. Correct-answer fields are absent. |
| `PUT /questions/:id` | Admin, throttled. Option updates are scoped to the question. |
| `POST /question-reports` | Authenticated, throttled. Reporter is the authenticated user. |
| `GET /question-reports`, `GET /question-reports/:id`, `POST /question-reports/review` | Admin. Review is throttled and records the actor. |
| `GET /subjects/:id/notes`, `GET /notes/:id` | Public catalogue with optional authenticated viewer state. Detail increments a public view counter. |
| `POST /subjects/:id/notes` | Admin, throttled. Upload promotion requires an upload owned by the actor. |
| `PATCH /notes/:id`, `DELETE /notes/:id` | Admin, throttled. Editing metadata is distinct from replacing a file, which checks note and upload ownership. |
| `POST /notes/:id/like` | Authenticated, throttled. Like scoped to the actor and note. |
| `POST /notes/:id/view` | Authenticated, throttled. Any authenticated user may request a file grant for a published note. |
| `GET /notes/:id/file` | Authenticated and signed, expiring grant for the note's current upload. The response is private and non-cacheable. |
| `POST /upload` | Authenticated, throttled. Issues a temporary note-upload record owned by its creator and a signed grant. |
| `PUT /uploads/:id` | Owned upload and valid grant required. Throttled and checks body length, media type, and PDF signature. |
| `GET /exams/generate/:subject_id`, `POST /exams/verify` | Optional auth, throttled. Guest mode and stored attempts follow distinct rules. Stored attempt IDs are scoped to the user. The pending-account guard comparison has a private follow-up. |
| `GET /exams/attempts/:id`, `DELETE /exams/attempts/:id` | Owner-only recover/discard. Queries use actor and UUID. Lifecycle operations serialize on the owner. |
| `GET /exams/state`, `POST /exams/state`, `DELETE /exams/state` | Owner-only by actor, subject and mode. Mutations are throttled and bind saved state to the owned attempt where present. |
| `GET /exams/pending`, `GET /exams` | Current-user pending attempts and completed history. |
| `GET /exams/:id` | Owner or admin for a stored result. Separately denies anonymous access and protects detailed grading and comments. |
| `GET /user`, `GET /user/scores`, `GET /user/answers` | Current user. Profile supports the pending-account resolution screen. Scores and history are session-scoped. |
| `POST /user/account-resolution` | Authenticated, throttled. Intended for the authorized pending identity. Local pending-record resolution is transactional. Its identity binding has a private follow-up. |
| `DELETE /user` | Current user, confirmation and throttle. Deletion checks the issuer subject and records a cutoff for existing tokens. |
| `GET /user/blocks`, `PUT /user/blocks/:id`, `DELETE /user/blocks/:id` | Actor's own block list. Target ID selects the other party. Write operations are throttled. |
| `GET /search`, `GET /users`, `GET /admin`, `GET /admin/exams` | Admin. User search and listing are restricted to that role. |
| `GET /events`, `POST /events/new`, `PATCH /events/:id`, `DELETE /events/:id` | Admin. Writes are throttled. |

## Control review

- **Identity and roles.** Required middleware verifies a bearer token through `ZitadelAuthService`. The service checks configured issuer and audience, expiry, not-before, subject and allowed RSA algorithms, then validates the signature with issuer-discovered JWKS. Verified email is required. UserInfo now has to identify the same subject whenever it supplies profile evidence. Admin roles come from the configured AuthNEI role claim. Database actor IDs come from the authenticated identity. Account deletion has an issued-before cutoff. Provider logout and account disablement are separate controls whose live behavior remains unverified.
- **Authorization and query safety.** Compared public routes with session, admin and owner-protected equivalents. Exam recovery, grading and state use actor-scoped UUID lookup; detailed review intentionally permits admins. Profiles, scores, visibility and block mutations use the actor. Inspected request validators, sort and pagination parameters, model writes, search, raw SQL and transaction entry points. Reviewed application SQL uses bound values or fixed SQL expressions. Reviewed account-deletion and notes/exam lock ordering separately from endpoint authorization.
- **Public identifiers and enumeration.** Catalogue, question, note, user and exam numeric IDs are resource selectors. Public catalogue objects are discoverable by design. User lists and search require admin access. Private lookups check identity or role before sending detailed records. UUIDs for saved attempts are scoped by owner even when supplied by the client, so authorization does not rely on entropy. Request IDs are correlation values, not proof of identity.
- **File grants and storage.** Upload IDs are random UUIDs. HMAC-SHA256 grants bind an upload ID or note/upload pair to at most five minutes, with constant-time signature comparison. A valid API session is required, plus ownership for uploads. Note grants can be reused within the window by an authenticated reader while the same file is published. Upload writes reject an already present object and constrain bytes, MIME and PDF magic. Promotion rechecks the stored object. User-controlled upload IDs do not choose network origins or arbitrary bucket paths. S3 endpoints and credentials come from runtime configuration.
- **Network, logs and config.** Database access uses the configured schema search path and a separate migration connection at startup when requested. See [shared data deployment](SHARED_DATA_DEPLOYMENT.md) and [database policy #82](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso-api-adonis/issues/82). S3 access should be private and bucket-scoped. JWKS and UserInfo destinations are supplied by configured issuer discovery. The API does not use browser cookies to authorize application routes. CORS is origin allowlisted. Request logs use route patterns and structured IDs, with token and database-field redaction. The PDF grant query and AuthNEI redirects still traverse ingress infrastructure whose redaction was outside the local review.
- **Jobs and webhooks.** No inbound webhook or shared-secret scheduler route is registered. The scheduled exam prune command runs under the API runtime identity and scopes deletion to stale unfinished attempts. The dependency audit workflow uses a job-scoped GitHub token with issue write access. The runtime schedule, role grants and GitHub workflow permissions were inspected in source or documentation only.

## Verification and remaining limits

- `npm ci`, lint, typecheck, code generation, build and migrations passed locally with Node 26.13.1 and PostgreSQL 16.15. All 248 Japa tests passed with an isolated database and UTC, matching the container time zone. The first run with local PostgreSQL time zone failed one unrelated timestamp-format assertion. Auth tests use synthetic RSA keys, a mocked issuer, and synthetic users. Functional coverage includes missing credentials, regular user versus admin, owner versus another user for saved and completed exams, pending identities, upload ownership, signatures, file policy and request-log redaction.
- `npm audit --omit=dev` reported three moderate package entries from two distinct public advisories, [minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249) and [qs](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw). The critical CI gate passed. Dependency remediation is tracked in [#182](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso-api-adonis/issues/182) and [#183](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso-api-adonis/issues/183). The flagged paths run through tooling and test-client dependencies shipped beneath `@adonisjs/auth`; this audit did not establish HTTP reachability.
- The production Docker image built successfully and its runtime user is `node`. Gitleaks found no leaks in the integration branch delta or proposed changes. Private source findings and remediation criteria are stored in [repository advisory drafts](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso-api-adonis/security/advisories). The audit also informs the existing [authorization issue #89](https://github.com/Nucleo-Estudantes-Informatica-ISEP/antirecurso-api-adonis/issues/89).
- No production requests were made. Staging verification should confirm the deployed SHA, live AuthNEI audience and role assignments, exact ingress/CORS behavior, upload/download with an isolated private bucket, redaction of signed URLs, and effective PostgreSQL and S3 privileges. Local migrations and mocked S3 checks do not establish live access grants.
