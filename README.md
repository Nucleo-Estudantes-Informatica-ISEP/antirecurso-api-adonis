# Antirecurso API

A robust backend API built with AdonisJS 7 for the Antirecurso platform. It provides RESTful endpoints to manage users, subjects, questions, exams, notes, comments, scores, and admin-managed events, persisting all data to a NEI shared PostgreSQL database.

## Key Features

- **Subject & Question Management**: Endpoints for retrieving, creating, and updating subjects, question types, and multiple-choice options.
- **Exams System**: Generate practice exams, verify answers, and track user scores.
- **Notes & Comments**: Allow users to upload, view, and comment on educational materials.
- **Events Management**: Admin endpoints for listing, creating, and updating platform events.
- **User Engagement**: Track scores, answer history, and content likes.
- **Bearer Authentication**: ZITADEL-issued access tokens protect authenticated and admin routes.
- **Health Check**: Native `/` endpoint to verify application liveness.

---

## Tech Stack

- **Language**: TypeScript 6
- **Framework**: AdonisJS 7
- **Database**: PostgreSQL 16 (NEI shared service)
- **ORM**: Lucid ORM
- **Validation**: VineJS
- **Authentication**: Custom Bearer-token validation for ZITADEL OIDC access tokens
- **Testing**: Japa
- **Linting & Formatting**: ESLint and Prettier

---

## Prerequisites

- Node.js 24 LTS
- npm with the committed `package-lock.json`
- Access to PostgreSQL and a private S3 bucket.
- ZITADEL issuer and audience details if you need to exercise authenticated routes locally.

---

## Getting Started

### 1. Clone the Repository

```bash
git clone <your-repository-url>
cd antirecurso-api-adonis
```

### 2. Install Dependencies

```bash
npm ci
```

### 3. Environment Setup

Copy .env.example to .env. Set restricted runtime DB credentials, DB schema, private S3 credentials, and AuthNEI issuer/audience. Use a separate migration identity only when applying migrations. Never use PostgreSQL admin or MinIO root credentials in the API.

For Coolify values and deployment order, see [shared data deployment](./docs/SHARED_DATA_DEPLOYMENT.md).

### 4. Database Setup

Once your `.env` file is populated with the database credentials, execute all the existing migrations to materialize the schema:

```bash
node ace migration:run
```

This applies the complete, versioned migration history, including pending-account and shared rate-limit state. Do not rely on a hard-coded table count; `node ace migration:status` is authoritative.

You can verify the status of the migrations at any time using:

```bash
node ace migration:status
```

### 5. Start Development Server

Run the AdonisJS development server with Hot Module Replacement (HMR) enabled:

```bash
npm run dev
```

Open [http://localhost:3333](http://localhost:3333) in your browser. You should receive a JSON response `{ "status": "ok" }`, confirming the API is running.

---

## Documentation

- [API reference](./docs/API.md)
- [Database schema reference](./docs/DATABASE_SCHEMA.md)

Use these two documents as the source of truth for request contracts, response shapes, relationships, and database constraints.

The events feature is covered by these admin-only routes:

- `GET /events`
- `POST /events/new`
- `PATCH /events/:id`
- `DELETE /events/:id`

---

## Architecture

### Directory Structure

```text
├── app/
│   ├── controllers/      # Route controllers (Exams, Notes, Events, Users, Subjects, etc.)
│   ├── exceptions/       # Custom application exceptions
│   ├── models/           # Lucid ORM models mapping to PostgreSQL tables
│   ├── middleware/       # HTTP middleware (e.g., auth, admin checks)
│   └── validators/       # VineJS validation schemas
├── config/
│   ├── database.ts       # Lucid ORM and PostgreSQL connection configuration
│   ├── auth.ts           # Authentication configuration
│   └── ...
├── database/
│   └── migrations/       # Schema definition files
├── start/
│   ├── env.ts            # Environment variable validation
│   ├── routes.ts         # All application endpoint definitions
│   └── kernel.ts         # Global and named middleware registration
├── tests/                # Japa test suite
└── bin/                  # Entry points (server.js, console.js)
```

### Request Lifecycle

1. A request hits the AdonisJS router (`start/routes.ts`).
2. Global and route-specific middleware (`app/middleware/`) execute (e.g., authentication).
3. The specific Controller (`app/controllers/`) processes the request payload, typically validating it using VineJS.
4. Controller invokes Lucid Models (`app/models/`) to interact with the shared PostgreSQL database.
5. The response is serialized to JSON and sent back to the client.

### Key Components

**Database and storage**

- Lucid uses restricted PostgreSQL credentials and the configured schema search path.
- StorageService uses bucket-scoped S3 credentials. API proxies PDF transfers; MinIO remains private.
- Browser upload and download links expire after five minutes and require AuthNEI login.

**Authentication (ZITADEL Bearer Tokens)**

- Authenticated routes use [`app/middleware/auth_middleware.ts`](./app/middleware/auth_middleware.ts), which validates Bearer tokens against the configured ZITADEL issuer.
- Optional-auth routes use [`app/middleware/optional_auth_middleware.ts`](./app/middleware/optional_auth_middleware.ts) so the same endpoint can return user-aware fields like `is_liked`.
- Authenticated routes require the validated AuthNEI `student` role. Admin-only routes additionally pass through [`app/middleware/admin_middleware.ts`](./app/middleware/admin_middleware.ts) and require the validated AuthNEI `admin` role.
- Token verification is implemented in [`app/services/auth/zitadel_auth_service.ts`](./app/services/auth/zitadel_auth_service.ts), including issuer, audience, signature, and expiry checks.

### Database Schema

The full table-by-table schema, constraints, deletion rules, and ER diagram live in [Database schema reference](./docs/DATABASE_SCHEMA.md).

---

## Environment Variables

See [.env.example](./.env.example) and [shared data deployment](./docs/SHARED_DATA_DEPLOYMENT.md). DB_URL is the runtime identity; DB_MIGRATION_URL is a separate schema owner used only for migrations. S3 credentials are server-side only. Preserve existing AuthNEI settings.

## Available Scripts

| Command                  | Description                                |
| ------------------------ | ------------------------------------------ |
| `npm run dev`            | Start the development server with HMR      |
| `npm run build`          | Compile TypeScript into `build/` directory |
| `npm run start`          | Run the compiled application               |
| `npm run test`           | Run the Japa test suite                    |
| `npm run lint`           | Run ESLint                                 |
| `npm run format`         | Run Prettier and format files              |
| `npm run typecheck`      | Validate TypeScript compilation            |
| `node ace migration:run` | Run pending database migrations            |
| `node ace list:routes`   | View all defined API routes                |

---

## Testing

The project uses [Japa](https://japa.dev/) for testing.

### Running Tests

```bash
# Run the entire test suite
npm run test

# Alternatively, using the ace CLI
node ace test
```

Test files are located in the `tests/` directory.

For regressions and security fixes, prefer TDD: add the focused failing Japa test first, implement the smallest correction, then refactor with all suites green. Repository-wide requirements are in [`AGENTS.md`](./AGENTS.md).

---

## Deployment

Follow [shared data deployment](./docs/SHARED_DATA_DEPLOYMENT.md). Review API and web PRs into dev, deploy and verify development, then promote reviewed dev into main. The API uses /compose.yml and the shared-data Docker network.

## Troubleshooting

Check the running container DB identity, current_schema(), bucket name, health endpoint, and migration status. Keep source Supabase until data and file verification passes. DB_SSL=false applies only to the private Docker network.

## AuthNEI shared-project authorization

The API treats ZITADEL/AuthNEI as the source of truth for authorization. Bearer tokens must have a
valid signature, exact configured issuer, unexpired lifetime, and at least one audience from the
required `AUTH_ALLOWED_AUDIENCES` list. Only RSA `RS256`, `RS384`, and `RS512` signatures are
accepted.

Project roles are normalized to `student`, `nei_member`, `admin`, and `employee` from the standard
ZITADEL project-role claim (including project-ID claim variants). Authenticated application routes
require `student`; admin middleware and controller defense-in-depth checks require `admin` from the
validated token. AuthNEI also owns current name, email, verification state, picture, and roles. Local
name, email, and verification columns are synchronized lookup/search caches, never authorization
inputs.

Set `AUTH_ROLE_CLAIM` only when the shared NEI Platform project emits a custom claim name. The
default is `urn:zitadel:iam:org:project:roles`.

## CI/CD gate

Every PR to `main` uses `npm ci` and must pass lint, typecheck, Japa tests, migrations against isolated PostgreSQL, production build and dependency audit, a non-root production Docker image, and Gitleaks. Green CI does not prove deployment: confirm the deployed SHA, migration status, `GET /`, exact CORS behavior, shared limits, storage promotion, and owner/admin boundaries after rollout.
