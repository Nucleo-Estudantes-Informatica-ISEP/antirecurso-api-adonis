# Frontend-to-Adonis API Contract

This file is the canonical HTTP contract for the Antirecurso frontend. It reflects
[`start/routes.ts`](../start/routes.ts), request validators, controllers, and services. Contract
changes must update this file in the same pull request.

## Transport and authentication

- Local base URL: `http://localhost:3333`
- Request and response bodies are JSON unless stated otherwise.
- Send AuthNEI/ZITADEL access tokens as `Authorization: Bearer <access-token>`.
- Bearer tokens are validated for signature, issuer, audience, expiry, subject, and verified email.
- `Public`: no token required.
- `Optional`: a request with no token is accepted; a supplied invalid token returns `401`.
- `Student`: valid token with the AuthNEI `student` application role.
- `Admin`: valid token with the AuthNEI `admin` application role.
- AuthNEI owns current name, email, verification, picture, and roles. Local name/email values are
  synchronized caches for lookup, search, account resolution, and historical display.
- Roles come only from validated AuthNEI claims. Persisted user rows never grant access.

Authenticated requests resolve the token subject to one local `users.id`. That local id owns scores,
answers, comments, notes, likes, reports, and saved exam state. Clients must never send an actor or
owner id unless a request schema below explicitly includes one.

## Common response and error rules

Schema notation uses TypeScript: `?` means optional, `| null` means nullable, and `T[]` means an
array. Undocumented fields must not be assumed stable.

Successful status codes:

- `200 OK` for reads and mutations returning a body.
- `201 Created` for new comments, events, notes, and question reports.
- `204 No Content` for successful updates/deletes without a body.

Controller/domain errors use `type MessageError = { message: string }`. Vine validation errors
return `422 Unprocessable Entity` with Adonis validation details. Common cross-endpoint errors:

- `401 Unauthorized`: token missing where required, malformed, invalid, expired, wrong issuer or
  audience, or identity-provider email not verified.
- `403 Forbidden`: required AuthNEI role missing, exam belongs to another user, or account resolution
  is pending.
- `404 Not Found`: route exists but referenced row does not.
- `422 Unprocessable Entity`: request fails its Vine or domain schema.
- `429 Too Many Requests`: a route-specific limiter was exceeded.
- `500 Internal Server Error`: unhandled database or upstream failure.

When account resolution is pending, every route using required-auth middleware except `GET /user`
and `POST /user/account-resolution` returns:

```json
{
  "message": "Account resolution required",
  "requires_account_resolution": true
}
```

### Pagination

Lucid-paginated endpoints return:

```ts
type PageMeta = {
  total: number
  perPage: number
  currentPage: number
  lastPage: number
  firstPage: number
  firstPageUrl: string
  lastPageUrl: string
  nextPageUrl: string | null
  previousPageUrl: string | null
}

type Page<T> = { meta: PageMeta; data: T[] }
```

`GET /comments` is the one legacy exception:

```ts
type CommentPageMeta = {
  total: number
  per_page: number
  current_page: number
  last_page: number
}
```

Invalid numeric `page`/`limit` values are normalized only where explicitly noted below. Consumers
should always send positive integers.

### Rate limits

Limits use authenticated local user id when available, otherwise request IP.

| Policy             | Routes                                                                                                    | Limit / block    |
| ------------------ | --------------------------------------------------------------------------------------------------------- | ---------------- |
| Exam               | `GET /exams/generate/:subject_id`, `POST /exams/verify`                                                   | 20/min; 5 min    |
| Mutation           | Scoreboard/comment/question/report/note/event mutations, note view, exam-state save/delete, report review | 30/min; 5 min    |
| Upload             | `POST /upload`                                                                                            | 10/5 min; 15 min |
| Account resolution | `POST /user/account-resolution`                                                                           | 5/15 min; 1 hour |

## Shared schemas

```ts
type Subject = { id: number; name: string; slug: string; year: number }

type UserSummary = {
  id: number
  name: string
  email: string
  avatar: string // MD5 of trim(lowercase(email))
}

type CurrentUserSummary = {
  id: number
  name: string // current AuthNEI claim/UserInfo
  email: string // current AuthNEI claim/UserInfo
  avatar: string // AuthNEI picture, falling back to normalized-email MD5
  is_admin: boolean
}

type Comment = {
  id: number
  comment: string
  user: string
  question_id: number
  created_at: string // ISO 8601
}

type Event = {
  id: number
  name: string
  description: string | null
  start_date: string // YYYY-MM-DD
  end_date: string // YYYY-MM-DD
  created_at: string // ISO 8601
  updated_at: string // ISO 8601
}

type QuestionOption = { id: number; name: string; order: string }

type Question = {
  id: number
  question: string
  exam: string
  image: string
  question_type: string
  options: QuestionOption[]
}

type QuestionReport = {
  id: number
  reason: string | null
  question: {
    id: number
    title: string
    image: string
    exam: string
    correct_option: string
    options: QuestionOption[]
  }
  created_at: string | null // relative pt-PT text, ISO fallback
  updated_at: string | null // relative pt-PT text, ISO fallback
  user: string
  email: string
  reviewed_at: string | null // ISO 8601
  solved: boolean
  reviewed_by: { name: string; email: string } | null
}

type Note = {
  id: number
  title: string
  url: string | null
  views: number
  user: UserSummary
  description: string | null
  n_pages: number | null
  subject: { id: number; name: string; slug: string }
  likes: number
  is_liked: boolean
  created_at: string // ISO 8601
  upload_id: string | null
}

type GeneratedQuestion = {
  id: number
  question: string
  exam: string
  image: string
  question_type: string
  options: { name: string; order: string }[]
}

type ExamMode = 'default' | 'realistic' | 'new' | 'wrong' | 'hard' | 'custom'

type SavedExamState = {
  version: 2
  subjectId: number
  mode: ExamMode
  questionIds: number[]
  answers: [number, string][] // [question id, one alphanumeric option]
  time: number // integer seconds, 0..28800
  currentQuestionIndex: number
  n_of_questions?: number // 5..50; required for custom
  penalizing_factor?: number // 0..1; required for custom
  filter?: string // max 100 characters
  totalQuestions: number // server-derived
  answered: number // server-derived
}
```

## Route matrix

| Method | Path                             | Access                                  | Success                     | Request summary                |
| ------ | -------------------------------- | --------------------------------------- | --------------------------- | ------------------------------ |
| GET    | `/`                              | Public                                  | `200`                       | none                           |
| GET    | `/subjects`                      | Public                                  | `200 Subject[]`             | query `with_questions?`        |
| GET    | `/subjects/:id`                  | Public                                  | `200 Subject`               | positive subject id            |
| GET    | `/subjects/:id/stats`            | Student; current user                   | `200 SubjectStats`          | positive subject id            |
| GET    | `/subjects/:id/scoreboard/:mode` | Public                                  | `200 Scoreboard`            | subject id and scoreboard mode |
| POST   | `/subjects/:id/scoreboard`       | Student; current user                   | `200 Message`               | `{ visibility }`               |
| GET    | `/comments`                      | Student                                 | `200 CommentPage`           | sort and pagination query      |
| POST   | `/comments`                      | Student; actor from token               | `201 Comment`               | `{ comment, question_id }`     |
| GET    | `/comments/:id`                  | Student                                 | `200 Comment`               | comment id                     |
| GET    | `/questions/:id`                 | Public                                  | `200 Question`              | question id                    |
| PUT    | `/questions/:id`                 | Admin                                   | `204`                       | question and option updates    |
| POST   | `/question-reports`              | Student; actor from token               | `201 QuestionReport`        | `{ question_id, reason? }`     |
| GET    | `/subjects/:id/notes`            | Optional                                | `200 Page<Note>`            | pagination query               |
| GET    | `/notes/:id`                     | Optional                                | `200 Note`                  | note id                        |
| PATCH  | `/notes/:id`                     | Admin                                   | `200 Note`                  | partial note update            |
| DELETE | `/notes/:id`                     | Admin                                   | `204`                       | note id                        |
| POST   | `/notes/:id/like`                | Student; actor from token               | `200 Note`                  | note id                        |
| POST   | `/subjects/:id/notes`            | Admin; actor from token                 | `201 Note`                  | note metadata and upload id    |
| POST   | `/notes/:id/view`                | Student                                 | `200 { url }`               | note id                        |
| POST   | `/upload`                        | Student                                 | `200 UploadGrant`           | target and content type        |
| GET    | `/exams/generate/:subject_id`    | Optional; mode-dependent                | `200 GeneratedQuestion[]`   | generation query               |
| POST   | `/exams/verify`                  | Optional; actor from token when present | `200 ExamResult`            | submitted exam                 |
| POST   | `/exams/state`                   | Student; current user                   | `200 SavedState`            | exam identity and state        |
| GET    | `/exams/state`                   | Student; current user                   | `200 SavedState/null`       | subject and mode query         |
| DELETE | `/exams/state`                   | Student; current user                   | `204`                       | subject and mode query         |
| GET    | `/exams/pending`                 | Student; current user                   | `200 PendingState[]`        | none                           |
| GET    | `/exams`                         | Student; current user                   | `200 Page<ExamHistoryItem>` | page query                     |
| GET    | `/exams/:id`                     | Student owner or Admin                  | `200 ExamDetail`            | exam id                        |
| GET    | `/user`                          | Student; current user                   | `200 UserSession`           | none                           |
| POST   | `/user/account-resolution`       | Student; current user                   | `200 Message`               | `{ action }`                   |
| GET    | `/user/scores`                   | Student; current user                   | `200 UserScore[]`           | none                           |
| GET    | `/user/answers`                  | Student; current user                   | `200 UserAnswer[]`          | none                           |
| GET    | `/search`                        | Admin                                   | `200 Page<UserSummary>`     | query and page                 |
| GET    | `/users`                         | Admin                                   | `200 Page<UserSummary>`     | page query                     |
| GET    | `/admin`                         | Admin; current user                     | `200 CurrentUserSummary`    | none                           |
| GET    | `/admin/exams`                   | Admin                                   | `200 AdminExamStats`        | none                           |
| GET    | `/events`                        | Admin                                   | `200 Page<Event>`           | pagination query               |
| POST   | `/events/new`                    | Admin                                   | `201 Event`                 | event body                     |
| PATCH  | `/events/:id`                    | Admin                                   | `200 Event`                 | partial event body             |
| DELETE | `/events/:id`                    | Admin                                   | `204`                       | event id                       |
| GET    | `/question-reports`              | Admin                                   | `200 QuestionReport[]`      | filter/sort query              |
| POST   | `/question-reports/review`       | Admin; reviewer from token              | `200 QuestionReport[]`      | report ids                     |
| GET    | `/question-reports/:id`          | Admin                                   | `200 QuestionReport`        | report id                      |

## Endpoint details

### Health

#### `GET /`

- Request: no path/query/body fields.
- Response: `200 { "status": "ok" }`.
- Endpoint-specific errors: none.

### Subjects and scoreboard

#### `GET /subjects`

- Query: `with_questions?: string`; only exact value `true` filters out subjects without questions.
- Response: `200 Subject[]`.

#### `GET /subjects/:id`

- Path: `id` is a subject id.
- Response: `200 Subject`.
- Errors: `404 { message: "Invalid subject" }`.

#### `GET /subjects/:id/stats`

- Path: `id` is a positive integer.
- Ownership: statistics always use authenticated local user id.
- Response:

```ts
type SubjectStats = {
  n_of_answers: number
  total_of_questions: number
  n_of_wrong_answers: number
  n_of_correct: number
  min_grade: number
  n_of_answered: number
  average_grade: number
  n_of_exams_taken: number
  n_of_exams_passed: number
  user_scores: {
    id: number
    score: number
    userId: number | null
    subjectId: number
    mode: string
    time: number | null
    createdAt: string
    updatedAt: string
  }[]
  exam_weight: number
  percentage_of_exams_passed: number
  percentage_of_correct_answers: number
  percentage_of_questions_seen: number
  mode_scores: Record<string, number>
  suggested_mode: string
  times: { time: number | null }[]
  mean_time: number | null
  place_in_scoreboard: number | null
}
```

- Errors: `422` invalid id; `404` missing subject.

#### `GET /subjects/:id/scoreboard/:mode`

- Path: positive subject `id`; `mode` is `all`, `default`, `hard`, `wrong`, `custom`,
  `realistic`, `new`, or `random`.
- Inclusion: `scores.show_scoreboard = true`, at least 3 matching exams, maximum 30 users.
- Response:

```ts
type Scoreboard = {
  subject_id: number
  name: string
  scores: { user_id: number; user_name: string; avatar: string; score: number; exams: number }[]
  limit: 30
  min_answers: 3
  total: number // all answers for subject, not returned-user count
}
```

- Errors: `422` invalid subject id/mode; `404` missing subject.

#### `POST /subjects/:id/scoreboard`

- Body: `{ visibility: boolean }`.
- Ownership: creates/updates only current user's score row for subject.
- Response: `200 { message: "Scoreboard visibility updated." }`.
- Errors: `404` missing subject; `422` invalid id/body; `429` mutation limit.

### Comments

#### `GET /comments`

- Query: `sort?: 'created_at' | 'id'`; invalid/omitted sort means no explicit ordering.
- Query: `order?: 'asc' | 'desc'`, default/fallback `asc`.
- Query: `page?`, default/fallback `1`; `per_page?`, default/fallback `20`, clamped to `1..100`.
- Response: `200 { meta: CommentPageMeta, data: Comment[] }`.

#### `POST /comments`

- Body: `{ comment: string /* 1..2000 */, question_id: number }`.
- Ownership: `user_id` is current user's local id.
- Response: `201 Comment`.
- Errors: `404 { message: "Question not found" }`; `422` invalid body; `429` mutation limit.

#### `GET /comments/:id`

- Path: comment id.
- Response: `200 Comment`.
- Errors: `404` missing comment.

### Questions

#### `GET /questions/:id`

- Path: question id.
- Response: `200 Question`.
- Errors: `404` missing question.

#### `PUT /questions/:id`

- Body:

```ts
{
  question: string
  correct_option: string
  options: {
    id: number
    name: string
  }
  ;[] // at least 2
}
```

- Authorization: AuthNEI `admin` is checked by middleware and controller.
- Semantics: option ids must belong to question; only names change; `correct_option` must match an
  existing option order. Entire update is transactional.
- Response: `204 No Content`.
- Errors: `404` missing question; `422` invalid body, option ownership, or correct option.

### Question reports

#### `POST /question-reports`

- Body: `{ question_id: number, reason?: string /* trimmed, non-empty */ }`.
- Ownership: reporter is current user's local id.
- Response: `201 QuestionReport`.
- Errors: `404 { message: "Question not found" }`; `422` invalid body. A duplicate
  `(question_id, user_id)` has no dedicated conflict status. Subject to mutation rate limit.

#### `GET /question-reports`

- Query: `solved?: 'true' | 'false'`.
- Query: `sort?: 'id' | 'question_id' | 'created_at' | 'reason' | 'user_id' |
'reviewed_at' | 'solved' | 'reviewed_by'`.
- Query: `order?: 'asc' | 'desc'`, used only with `sort`, default `asc`.
- Response: `200 QuestionReport[]`; not paginated.
- Errors: `422` invalid filter/sort query.

#### `GET /question-reports/:id`

- Path: report id.
- Response: `200 QuestionReport`.
- Errors: `404` missing report.

#### `POST /question-reports/review`

- Body: `{ question_ids: number[] }`; despite legacy name, values are question-report ids.
- Ownership: `reviewed_by` is current admin's local id.
- Semantics: only unreviewed reports change. Response contains reports changed by this request;
  already-reviewed ids may therefore be absent.
- Response: `200 QuestionReport[]`.
- Errors: `422` empty/invalid array or any missing report id; `429` mutation limit.

### Notes and uploads

Creation flow: call `POST /upload`, upload PDF directly to returned Supabase URL, then call
`POST /subjects/:id/notes` with returned `id` as `upload_id`.

#### `POST /upload`

- Body: `{ target: 'notes', contentType: 'application/pdf' }`.
- Response:

```ts
type UploadGrant = {
  id: string
  contentType: 'application/pdf'
  target: 'notes'
  maxSize: 67108864
  expires: string // ISO 8601, five minutes after issue
  url: string
  headers: { 'x-upsert': 'false' }
  uploadMode: 'supabase-signed-put'
}
```

- Errors: `400` unsupported target/type; `422` invalid fields; `503` storage not configured; `500`
  Supabase failure with `{ message, status }`; `429` upload limit.

#### `GET /subjects/:id/notes`

- Path: numeric subject id.
- Query: `page?`, default/fallback `1`; `limit?`, default/fallback `15`, maximum `100`.
- Optional identity: `is_liked` is current-user-specific with token, otherwise `false`.
- Response: `200 Page<Note>`.
- Errors: `400` invalid id; `404` missing subject; `401` invalid supplied token.

#### `GET /notes/:id`

- Side effect: increments `views` before returning note.
- Optional identity: `is_liked` is current-user-specific with token.
- Response: `200 Note`.
- Errors: `404` missing note; `401` invalid supplied token.

#### `POST /subjects/:id/notes`

- Body: `{ upload_id: string, title: string, description?: string, n_pages?: number }`.
- Ownership: author is current admin's local id.
- Storage boundary: object must exist, be at most 64 MiB, report PDF type, and have PDF signature.
- Response: `201 Note`.
- Errors: `400` invalid subject/upload/object; `404` missing subject; `422` invalid body; `503`
  storage not configured; `500` upstream failure; `429` mutation limit.

#### `PATCH /notes/:id`

- Body: any subset of `{ upload_id, subject_id, title, description, n_pages }`; strings are
  non-empty and numeric fields are numbers.
- Response: `200 Note`.
- Errors: `400` invalid upload/object; `404` missing note; `422` invalid body; `503` storage not
  configured; `500` upstream/storage/database failure; `429` mutation limit.

#### `DELETE /notes/:id`

- Side effects: deletes uploaded/distributed objects, then note. Missing storage configuration does
  not block row deletion.
- Response: `204 No Content`.
- Errors: `404` missing note; `400` storage error; `500` upstream failure; `429` mutation limit.

#### `POST /notes/:id/like`

- Ownership: toggles current user's like; duplicate insert races are tolerated.
- Response: `200 Note` with current `likes` and `is_liked`.
- Errors: `404` missing note; `429` mutation limit.

#### `POST /notes/:id/view`

- Side effect: increments `views`.
- Response: `200 { url: string }`; direct `notes.url` when present, otherwise five-minute signed
  Supabase URL.
- Errors: `404` missing note/no file; `400` missing storage object; `503` storage not configured;
  `500` upstream failure; `429` mutation limit.

### Exams

`default` and `realistic` generation work anonymously. `new`, `wrong`, `hard`, and `custom`
generation require a valid user. Verification may be anonymous for every mode; authenticated
verification owns answer, updates scoreboard, and completes matching saved state.

#### `GET /exams/generate/:subject_id`

- Query: `mode?: ExamMode`, default `default`; `n_of_questions?: integer` in `5..50`, required for
  `custom`; `filter?: string`, with only `filter=new` changing current custom behavior.
- Response: `200 GeneratedQuestion[]`.
- Errors: `400` invalid id/custom count/generation; `401` user-dependent mode without user or invalid
  token; `404` missing subject; `422` invalid query; `429` exam limit.

#### `POST /exams/verify`

- Body:

```ts
{
  subject_id: number
  mode?: ExamMode
  time?: number // positive integer
  n_of_questions?: number // 5..50, required for custom
  penalizing_factor?: number // 0..1
  answers: { question_id: number; selected_option?: string }[]
}
```

- Validation: answer count matches mode; question ids are unique, exist, and belong to subject;
  selected option is one alphanumeric character and must exist for question.
- Transaction: answer/detail, score, scoreboard, and saved-state completion commit together.
- Response: `200 { id, score, wrong_answers, passed, subject }` with numeric fields as numbers.
- Errors: `400` domain mismatch; `401` invalid supplied token; `404` missing subject; `422` invalid
  body; `429` exam limit.

#### `POST /exams/state`

- Body: `{ subject_id: number, mode: ExamMode, state: SavedExamState }`.
- Identity: inner subject/mode match outer fields; question ids are unique and belong to subject;
  answers reference unique ids in `questionIds`.
- Ownership/upsert: current user + subject + mode. Completed state cannot change.
- Response: `200 { id: number, state: SavedExamState }`.
- Errors: `400` invalid state/cross-subject questions; `404` missing subject; `409` completed state;
  `422` invalid outer body; `429` mutation limit.

#### `GET /exams/state`

- Query: required positive integer `subject_id`; `mode?: ExamMode`, default `default`.
- Ownership: current user's incomplete state only.
- Response: `200 { state: null }` when absent/invalid stored state, otherwise
  `200 { id: number, state: SavedExamState & { savedAt: number } }`; `savedAt` is epoch milliseconds.
- Errors: `422` invalid query.

#### `DELETE /exams/state`

- Query: required positive integer `subject_id`; `mode?: ExamMode`, default `default`.
- Ownership: current user's matching state only; absent state is success.
- Response: `204 No Content`.
- Errors: `422` invalid query; `429` mutation limit.

#### `GET /exams/pending`

- Ownership: current user's incomplete, structurally valid states, newest first. Invalid stored states
  are omitted.
- Response:

```ts
{
  data: {
    id: number
    subject: string
    subject_id: number
    mode: ExamMode
    state: SavedExamState & { savedAt: number }
    created_at: string
    updated_at: string
  }
  ;[]
}
```

#### `GET /exams`

- Query: `page?: positive integer`, default `1`; fixed page size `10`.
- Ownership: current user's attempts, newest first.
- Response: `200 Page<{ id, score, subject, mode, time, created_at }>`.
- Errors: `422` invalid page.

#### `GET /exams/:id`

- Ownership: current user reads own attempt; AuthNEI admin reads any. Anonymous attempts are
  admin-only.
- Response:

```ts
type ExamDetail = {
  id: number
  score: number
  taken_at: string // dd/MM/yyyy
  subject: string
  questions: {
    question: {
      id: number
      question: string
      correct_option: string
      question_type: string
      image: string
    }
    selected_option_id: number | null
    options: QuestionOption[]
    is_wrong: boolean
    correct_option: string
    comments: (Comment & { user_avatar: string })[]
  }[]
}
```

- Errors: `400` invalid id; `403` not owner/admin; `404` missing attempt.

#### `GET /admin/exams`

- Response:

```ts
type AdminExamStats = {
  exams_per_day: { date: string; count: number }[]
  exams_per_subject: { name: string; count: number }[]
  exams_per_mode: { mode: string; count: number }[]
}
```

### User, account resolution, and admin directory

Authentication resolves local account by AuthNEI subject, then verified email. A legacy email match
without same subject creates pending resolution. Until resolved, only session and resolution routes
are allowed.

#### `GET /user`

- Ownership: current user only.
- Response:

```ts
type UserSession = CurrentUserSummary & {
  requires_account_resolution: boolean
  account_summary: {
    email: string
    pending_auth_subject: string
    scores: number
    answers: number
  } | null
}
```

#### `POST /user/account-resolution`

- Body: `{ action: 'keep' | 'discard' }`.
- `keep`: preserve data, assign pending AuthNEI subject, remove marker.
- `discard`: delete local answers, scores, reports, and user; relational cascades also apply. Later
  authentication recreates an empty local account.
- Transaction/ownership: current user's marker is locked and resolved.
- Response: `200 { message: 'Account linked successfully' | 'Account data discarded successfully' }`.
- Errors: `400` invalid action/no pending marker; `429` account-resolution limit.

#### `GET /user/scores`

- Ownership: current user only.
- Response:

```ts
{
  score: number
  subject_id: number
  subject: string
  user: string
  show_scoreboard: boolean
}
;[]
```

#### `GET /user/answers`

- Ownership: current user only.
- Response:

```ts
{
  id: number
  score: number
  subject: string
  user_name: string
  mode: string
  time: number | null
  created_at: string
}
;[]
```

#### `GET /search`

- Query: required trimmed non-empty `query`, case-insensitive substring over local name/email;
  `page?`, default/fallback `1`; fixed page size `15`.
- Response: `200 Page<UserSummary>`. Cached directory entries do not expose roles.
- Errors: `422` missing/empty query.

#### `GET /users`

- Query: `page?`, default/fallback `1`; fixed page size `15`.
- Response: `200 Page<UserSummary>`. Cached directory entries do not expose roles.

#### `GET /admin`

- Response: `200 CurrentUserSummary` for current admin. `is_admin` is computed from current AuthNEI
  roles.

### Events

#### `GET /events`

- Query: `page?`, default/fallback `1`; `limit?`, default/fallback `15`, maximum `100`.
- Ordering: `start_date` descending.
- Response: `200 Page<Event>`.

#### `POST /events/new`

- Body: `{ name: string, description?: string, start_date: 'YYYY-MM-DD', end_date: 'YYYY-MM-DD' }`;
  name is trimmed/minimum 2; end is same as or after start; blank description becomes `null`.
- Response: `201 Event`.
- Errors: `422` invalid body/date range; `429` mutation limit.

#### `PATCH /events/:id`

- Body: any subset of create fields; resulting date range must remain valid. Blank description
  becomes `null`.
- Response: `200 Event`.
- Errors: `400` invalid resulting range; `404` missing event; `422` invalid body; `429` mutation limit.

#### `DELETE /events/:id`

- Response: `204 No Content`.
- Errors: `404` missing event; `429` mutation limit.
