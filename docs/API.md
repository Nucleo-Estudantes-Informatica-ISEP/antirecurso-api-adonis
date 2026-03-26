# API Documentation

This document describes the HTTP contract implemented in [`start/routes.ts`](../start/routes.ts), the request validators under [`app/validators/`](../app/validators), and the controller/service behavior in [`app/controllers/`](../app/controllers) and [`app/services/`](../app/services).

## Base URL

- Local development: `http://localhost:3333`
- Content type: JSON unless noted otherwise
- Health endpoint: `GET /`

## Authentication

The API uses Bearer access tokens issued by ZITADEL and validated by [`app/services/auth/zitadel_auth_service.ts`](../app/services/auth/zitadel_auth_service.ts).

Send tokens with:

```http
Authorization: Bearer <access-token>
```

Route protection levels used in this API:

- `Public`: no token required
- `Optional auth`: token is optional; if present, the request is authenticated
- `Authenticated`: valid Bearer token required
- `Admin`: valid Bearer token required and `authUser.isAdmin === true`

## Response Conventions

- Paginated endpoints return `{ meta, data }`
- Most timestamps are ISO 8601 strings
- Event `start_date` and `end_date` values are serialized as `YYYY-MM-DD`
- `GET /exams/:id` returns `taken_at` as `dd/MM/yyyy`
- Question report `created_at` and `updated_at` are relative strings in `pt-PT`
- User avatars are MD5 hashes of the normalized email address

## Error Conventions

Common status codes returned by this API:

- `200 OK`: successful read or mutation with response body
- `201 Created`: resource created
- `204 No Content`: successful update/delete without body
- `400 Bad Request`: malformed route/query/body combination
- `401 Unauthorized`: missing or invalid Bearer token
- `403 Forbidden`: authenticated but not allowed
- `404 Not Found`: missing subject/question/note/exam/report
- `422 Unprocessable Entity`: Vine validation failure or domain validation failure

## Exam Modes

Exam generation and verification use these modes from [`app/services/exams/exam_config.ts`](../app/services/exams/exam_config.ts):

| Mode        | Generation auth              | Behavior                                                                            |
| ----------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `default`   | Public                       | Random questions using default rule set                                             |
| `realistic` | Public                       | Uses subject-specific question count and penalty rules                              |
| `new`       | Authenticated                | Prioritizes unseen questions for the user, then fills from fallback pool            |
| `wrong`     | Authenticated                | Prioritizes questions the user most recently got wrong                              |
| `hard`      | Authenticated                | Prioritizes globally hard questions based on wrong-answer counts                    |
| `custom`    | Authenticated for generation | Uses `n_of_questions`; `filter=new` is currently the only supported filter behavior |

## Endpoint Reference

### Health

#### `GET /`

- Auth: `Public`
- Purpose: lightweight liveness check
- Response:

```json
{
  "status": "ok"
}
```

### Subjects

#### `GET /subjects`

- Auth: `Public`
- Query parameters:
  - `with_questions=true`: only return subjects that currently have at least one question
- Response shape:

```json
[
  {
    "id": 1,
    "name": "Subject name",
    "slug": "subject-slug",
    "year": 2025
  }
]
```

#### `GET /subjects/:id`

- Auth: `Public`
- Path parameters:
  - `id`: numeric subject id
- Response shape: same as `GET /subjects`

#### `GET /subjects/:id/stats`

- Auth: `Authenticated`
- Path parameters:
  - `id`: numeric subject id
- Purpose: returns the authenticated user's subject progress summary from [`app/services/stats_service.ts`](../app/services/stats_service.ts)
- Response fields:
  - `n_of_answers`
  - `total_of_questions`
  - `n_of_wrong_answers`
  - `n_of_correct`
  - `min_grade`
  - `n_of_answered`
  - `average_grade`
  - `n_of_exams_taken`
  - `n_of_exams_passed`
  - `user_scores`
  - `exam_weight`
  - `percentage_of_exams_passed`
  - `percentage_of_correct_answers`
  - `percentage_of_questions_seen`
  - `mode_scores`
  - `suggested_mode`
  - `times`
  - `mean_time`
  - `place_in_scoreboard`

#### `GET /subjects/:id/scoreboard/:mode`

- Auth: `Public`
- Path parameters:
  - `id`: numeric subject id
  - `mode`: `all`, `default`, `hard`, `wrong`, `custom`, `realistic`, `new`, or `random`
- Notes:
  - only users with `scores.show_scoreboard = true` are included
  - users must have at least 3 exams for the subject
  - maximum 30 rows
- Response shape:

```json
{
  "subject_id": 1,
  "name": "Subject name",
  "scores": [
    {
      "user_id": 42,
      "user_name": "Jane Doe",
      "avatar": "md5hash",
      "score": 87.33,
      "exams": 6
    }
  ],
  "limit": 30,
  "min_answers": 3,
  "total": 120
}
```

#### `POST /subjects/:id/scoreboard`

- Auth: `Authenticated`
- Body:

```json
{
  "visibility": true
}
```

- Purpose: toggles the authenticated user's inclusion in the subject scoreboard
- Response:

```json
{
  "message": "Scoreboard visibility updated."
}
```

### Comments

#### `GET /comments`

- Auth: `Authenticated`
- Query parameters:
  - `sort`: `created_at` or `id`
  - `order`: `asc` or `desc`
  - `page`: positive integer, default `1`
  - `per_page`: positive integer, default `20`, max `100`
- Response shape:

```json
{
  "meta": {
    "total": 1,
    "per_page": 20,
    "current_page": 1,
    "last_page": 1
  },
  "data": [
    {
      "id": 10,
      "comment": "Great explanation",
      "user": "Jane Doe",
      "question_id": 7,
      "created_at": "2026-03-26T12:00:00.000+00:00",
      "is_admin": false
    }
  ]
}
```

#### `POST /comments`

- Auth: `Authenticated`
- Body:

```json
{
  "comment": "Question text feedback",
  "question_id": 7
}
```

- Validation:
  - `comment`: string, 1..2000 chars
  - `question_id`: number

#### `GET /comments/:id`

- Auth: `Authenticated`
- Response shape: same item shape as `POST /comments`

### Events

#### `GET /events`

- Auth: `Admin`
- Query parameters:
  - `page`: positive integer, default `1`
  - `limit`: positive integer, default `15`, max `100`
- Purpose: lists admin-managed events for the dashboard
- Response shape:

```json
{
  "meta": {
    "total": 1,
    "perPage": 15,
    "currentPage": 1,
    "lastPage": 1,
    "firstPage": 1,
    "firstPageUrl": "/?page=1",
    "lastPageUrl": "/?page=1",
    "nextPageUrl": null,
    "previousPageUrl": null
  },
  "data": [
    {
      "id": 1,
      "name": "Semana de Testes",
      "description": "Atividades especiais para a semana académica.",
      "start_date": "2026-04-01",
      "end_date": "2026-04-05",
      "created_at": "2026-03-26T12:00:00.000+00:00",
      "updated_at": "2026-03-26T12:00:00.000+00:00"
    }
  ]
}
```

#### `POST /events/new`

- Auth: `Admin`
- Body:

```json
{
  "name": "Semana de Testes",
  "description": "Atividades especiais para a semana académica.",
  "start_date": "2026-04-01",
  "end_date": "2026-04-05"
}
```

- Validation:
  - `name`: string, trimmed, minimum 2 characters
  - `description`: optional string
  - `start_date`: date in `YYYY-MM-DD`
  - `end_date`: date in `YYYY-MM-DD`, must be the same as or after `start_date`
- Response: `201 Created` with the created event object

#### `PATCH /events/:id`

- Auth: `Admin`
- Path parameters:
  - `id`: numeric event id
- Body: any subset of the create payload
- Validation:
  - all fields are optional
  - the resulting date range must satisfy `end_date >= start_date`
- Response: `200 OK` with the updated event object
- Errors:
  - `400` when the resulting date range is invalid
  - `404` when the event does not exist

#### `DELETE /events/:id`

- Auth: `Admin`
- Path parameters:
  - `id`: numeric event id
- Purpose: permanently removes an event
- Response: `204 No Content`
- Errors:
  - `404` when the event does not exist

### Questions

#### `GET /questions/:id`

- Auth: `Public`
- Response shape:

```json
{
  "id": 7,
  "question": "Question statement",
  "exam": "exam-code",
  "image": "https://...",
  "question_type": "Multiple choice",
  "options": [
    {
      "id": 70,
      "name": "Option text",
      "order": "A"
    }
  ]
}
```

#### `PUT /questions/:id`

- Auth: `Admin`
- Body:

```json
{
  "question": "Updated statement",
  "correct_option": "B",
  "options": [
    {
      "id": 70,
      "name": "Updated option A"
    },
    {
      "id": 71,
      "name": "Updated option B"
    }
  ]
}
```

- Validation:
  - `question`: non-empty string
  - `correct_option`: non-empty string, must match one existing option `order`
  - `options`: at least 2 entries
- Response: `204 No Content`

### Question Reports

#### `POST /question-reports`

- Auth: `Authenticated`
- Body:

```json
{
  "question_id": 7,
  "reason": "Option B is duplicated"
}
```

- Notes:
  - `reason` is optional
  - one user can report a given question only once due to the database unique constraint

#### `GET /question-reports`

- Auth: `Admin`
- Query parameters:
  - `solved`: `true` or `false`
  - `sort`: `id`, `question_id`, `created_at`, `reason`, `user_id`, `reviewed_at`, `solved`, `reviewed_by`
  - `order`: `asc` or `desc`

#### `GET /question-reports/:id`

- Auth: `Admin`

#### `POST /question-reports/review`

- Auth: `Admin`
- Body:

```json
{
  "question_ids": [1, 2, 3]
}
```

- Purpose: marks the provided report ids as solved and stamps `reviewed_at` and `reviewed_by`

Question report item shape for list/show/create/review responses:

```json
{
  "id": 1,
  "reason": "Incorrect answer key",
  "question": {
    "id": 7,
    "title": "Question statement",
    "image": "https://...",
    "exam": "exam-code",
    "correct_option": "C",
    "options": [
      {
        "id": 70,
        "name": "Option text",
        "order": "A"
      }
    ]
  },
  "created_at": "há 2 dias",
  "updated_at": "há 1 dia",
  "user": "Jane Doe",
  "email": "jane@example.com",
  "reviewed_at": "2026-03-26T12:00:00.000+00:00",
  "solved": true,
  "reviewed_by": {
    "name": "Admin User",
    "email": "admin@example.com"
  }
}
```

### Notes and Uploads

Notes depend on Supabase Storage when `upload_id` is used.

Recommended creation flow:

1. `POST /upload` to request a signed upload URL
2. Upload the file directly to Supabase Storage with the returned signed URL
3. `POST /subjects/:id/notes` to promote the uploaded object and create the note row

#### `POST /upload`

- Auth: `Authenticated`
- Body:

```json
{
  "target": "notes",
  "contentType": "application/pdf"
}
```

- Current supported upload target:
  - `notes`
- Current supported content type:
  - `application/pdf`
- Response shape:

```json
{
  "id": "uuid",
  "contentType": "application/pdf",
  "target": "notes",
  "maxSize": 67108864,
  "expires": "2026-03-26T12:00:00.000Z",
  "url": "https://...signed-put-url...",
  "headers": {
    "x-upsert": "false"
  },
  "uploadMode": "supabase-signed-put"
}
```

#### `GET /subjects/:id/notes`

- Auth: `Optional auth`
- Query parameters:
  - `page`: positive integer, default `1`
  - `limit`: positive integer, default `15`, max `100`
- If authenticated, `is_liked` is computed for the current user

#### `POST /subjects/:id/notes`

- Auth: `Admin`
- Body:

```json
{
  "upload_id": "uuid-from-upload-endpoint",
  "title": "Study note title",
  "description": "Optional description",
  "n_pages": 32
}
```

#### `GET /notes/:id`

- Auth: `Optional auth`
- Notes:
  - increments the `views` counter
  - returns note metadata, not the signed file URL

#### `POST /notes/:id/view`

- Auth: `Authenticated`
- Notes:
  - increments the `views` counter
  - returns `{ "url": "..." }`
  - if `notes.url` is already set, that direct URL is returned
  - otherwise, a signed Supabase download URL is returned

#### `PATCH /notes/:id`

- Auth: `Admin`
- Body fields are all optional:
  - `upload_id`
  - `subject_id`
  - `title`
  - `description`
  - `n_pages`

#### `DELETE /notes/:id`

- Auth: `Admin`
- Response: `204 No Content`

#### `POST /notes/:id/like`

- Auth: `Authenticated`
- Purpose: toggles the current user's like for the note

Shared note response shape for list/show/create/update/like:

```json
{
  "id": 11,
  "title": "Study note title",
  "url": null,
  "views": 4,
  "user": {
    "id": 2,
    "name": "Jane Doe",
    "email": "jane@example.com",
    "avatar": "md5hash",
    "is_admin": false
  },
  "description": "Optional description",
  "n_pages": 32,
  "subject": {
    "id": 1,
    "name": "Subject name",
    "slug": "subject-slug"
  },
  "likes": 3,
  "is_liked": true,
  "created_at": "2026-03-26T12:00:00.000+00:00",
  "upload_id": "uuid"
}
```

### Exams

#### `GET /exams/generate/:subject_id`

- Auth: `Optional auth`
- Query parameters:
  - `mode`: `default`, `realistic`, `new`, `wrong`, `hard`, or `custom`
  - `n_of_questions`: required for `custom`, min `5`, max `50`
  - `filter`: optional string; `new` has explicit service behavior in custom mode
- Important behavior:
  - `new`, `wrong`, `hard`, and `custom` currently require an authenticated user
  - `realistic` uses subject-specific exam rules
- Response shape:

```json
[
  {
    "id": 7,
    "question": "Question statement",
    "exam": "exam-code",
    "image": "https://...",
    "question_type": "Multiple choice",
    "options": [
      {
        "name": "Option text",
        "order": "A"
      }
    ]
  }
]
```

#### `POST /exams/verify`

- Auth: `Optional auth`
- Body:

```json
{
  "subject_id": 1,
  "mode": "default",
  "time": 480,
  "penalizing_factor": 0.25,
  "n_of_questions": 10,
  "answers": [
    {
      "question_id": 7,
      "selected_option": "A"
    }
  ]
}
```

- Validation and behavior:
  - `answers.length` must exactly match the expected question count for the selected mode
  - `question_id` values must be unique
  - `selected_option` is optional; omitted or empty means unanswered
  - `selected_option` must match an existing option `order` for the question
  - when authenticated, the resulting score is accumulated into the `scores` table
- Response shape:

```json
{
  "id": 120,
  "score": 83.33,
  "wrong_answers": 2,
  "passed": true,
  "subject": "Subject name"
}
```

#### `GET /exams`

- Auth: `Authenticated`
- Query parameters:
  - `page`: positive integer
- Response shape:

```json
{
  "meta": {
    "total": 1,
    "per_page": 10,
    "current_page": 1,
    "last_page": 1
  },
  "data": [
    {
      "id": 120,
      "score": 83,
      "subject": "Subject name",
      "mode": "default",
      "time": 480,
      "created_at": "2026-03-26T12:00:00.000+00:00"
    }
  ]
}
```

#### `GET /exams/:id`

- Auth: `Authenticated`
- Authorization:
  - admins can inspect any exam
  - non-admins can inspect only their own exam
- Response shape:

```json
{
  "id": 120,
  "score": 83,
  "taken_at": "26/03/2026",
  "subject": "Subject name",
  "questions": [
    {
      "question_id": 7,
      "question": "Question statement",
      "selected_option_id": 70,
      "options": [
        {
          "id": 70,
          "name": "Option text",
          "order": "A"
        }
      ],
      "is_wrong": false,
      "correct_option": "A",
      "comments": [
        {
          "id": 5,
          "comment": "Helpful note",
          "user": "Jane Doe",
          "question_id": 7,
          "created_at": "2026-03-26T12:00:00.000+00:00",
          "is_admin": false,
          "user_avatar": "md5hash"
        }
      ]
    }
  ]
}
```

#### `GET /admin/exams`

- Auth: `Admin`
- Response fields:
  - `exams_per_day`
  - `exams_per_subject`
  - `exams_per_mode`

### User and Admin Views

#### `GET /user`

- Auth: `Authenticated`
- Returns the current user:

```json
{
  "id": 2,
  "name": "Jane Doe",
  "email": "jane@example.com",
  "avatar": "md5hash",
  "is_admin": false
}
```

#### `GET /user/scores`

- Auth: `Authenticated`
- Response item shape:

```json
{
  "score": 320,
  "subject_id": 1,
  "subject": "Subject name",
  "user": "Jane Doe",
  "show_scoreboard": true
}
```

#### `GET /user/answers`

- Auth: `Authenticated`
- Response item shape:

```json
{
  "id": 120,
  "score": 83,
  "subject": "Subject name",
  "user_name": "Jane Doe",
  "mode": "default",
  "time": 480,
  "created_at": "2026-03-26T12:00:00.000+00:00"
}
```

#### `GET /search`

- Auth: `Admin`
- Query parameters:
  - `query`: required search string
  - `page`: positive integer, default `1`

#### `GET /users`

- Auth: `Admin`
- Query parameters:
  - `page`: positive integer, default `1`

Both `/search` and `/users` return:

```json
{
  "meta": {
    "total": 1,
    "per_page": 15,
    "current_page": 1,
    "last_page": 1
  },
  "data": [
    {
      "id": 2,
      "name": "Jane Doe",
      "email": "jane@example.com",
      "avatar": "md5hash",
      "is_admin": false
    }
  ]
}
```

#### `GET /admin`

- Auth: `Admin`
- Returns the same user shape as `GET /user`
