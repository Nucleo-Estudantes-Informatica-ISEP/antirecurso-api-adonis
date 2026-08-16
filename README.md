# Antirecurso API

A robust backend API built with AdonisJS 6 for the Antirecurso platform. It provides RESTful endpoints to manage users, subjects, questions, exams, notes, comments, scores, and admin-managed events, persisting all data to a Supabase-hosted PostgreSQL database.

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

- **Language**: TypeScript
- **Framework**: AdonisJS 6
- **Database**: PostgreSQL 15+ (hosted on Supabase)
- **ORM**: Lucid ORM
- **Validation**: VineJS
- **Authentication**: Custom Bearer-token validation for ZITADEL OIDC access tokens
- **Testing**: Japa
- **Linting & Formatting**: ESLint and Prettier

---

## Prerequisites

- Node.js 22 LTS
- npm with the committed `package-lock.json`
- A **Supabase** account to host the PostgreSQL database instance.
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

Copy the example environment file to create your local `.env`:

```bash
cp .env.example .env
```

To connect to your **Supabase PostgreSQL** instance, ensure you configure the direct connection string (port `5432`, not `6543`) in your `.env` file:

| Variable                     | Description                                              | Example                                                      |
| ---------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| `PORT`                       | Application Port                                         | `3333`                                                       |
| `NODE_ENV`                   | Application environment                                  | `development`                                                |
| `DB_URL`                     | Supabase direct Postgres connection string               | `postgresql://postgres:...@db.xxx.supabase.co:5432/postgres` |
| `DB_SSL`                     | Enable SSL for Postgres                                  | `true`                                                       |
| `DB_SSL_REJECT_UNAUTHORIZED` | Require full certificate validation                      | `false`                                                      |
| `AUTH_ISSUER_URL`            | ZITADEL issuer URL used to validate JWTs                 | `https://zitadel.example.com`                                |
| `AUTH_ALLOWED_AUDIENCES`     | Comma-separated accepted token audiences                 | `api,web`                                                    |
| `SUPABASE_URL`               | Supabase project URL for Storage API                     | `https://xxx.supabase.co`                                    |
| `SUPABASE_SERVICE_ROLE_KEY`  | Service role key used server-side for Storage operations | `eyJ...`                                                     |
| `SUPABASE_STORAGE_BUCKET`    | Private bucket that stores note PDFs                     | `notes`                                                      |

### 4. Database Setup

Once your `.env` file is populated with the Supabase credentials, execute all the existing migrations to materialize the schema:

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
│   ├── database.ts       # Lucid ORM and Supabase connection configuration
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
4. Controller invokes Lucid Models (`app/models/`) to interact with the Supabase PostgreSQL database.
5. The response is serialized to JSON and sent back to the client.

### Key Components

**Database Connection (Supabase)**

- The application uses `config/database.ts` to manage the connection.
- **SSL configuration is environment-driven**. Supabase requires SSL connections. In `config/database.ts`, SSL is enabled when `DB_SSL=true`, and certificate verification is controlled by `DB_SSL_REJECT_UNAUTHORIZED`.
- **Connection Mode**: Supabase provides both a _Direct Connection_ (port 5432) and a _Connection Pooler_ (port 6543, using PgBouncer in transaction mode). Because Lucid/Knex uses prepared statements by default (which transaction-mode PgBouncer does not support), **the direct connection (port 5432) is required and recommended**.

**Authentication (ZITADEL Bearer Tokens)**

- Authenticated routes use [`app/middleware/auth_middleware.ts`](./app/middleware/auth_middleware.ts), which validates Bearer tokens against the configured ZITADEL issuer.
- Optional-auth routes use [`app/middleware/optional_auth_middleware.ts`](./app/middleware/optional_auth_middleware.ts) so the same endpoint can return user-aware fields like `is_liked`.
- Authenticated routes require the validated AuthNEI `student` role. Admin-only routes additionally pass through [`app/middleware/admin_middleware.ts`](./app/middleware/admin_middleware.ts) and require the validated AuthNEI `admin` role.
- Token verification is implemented in [`app/services/auth/zitadel_auth_service.ts`](./app/services/auth/zitadel_auth_service.ts), including issuer, audience, signature, and expiry checks.

### Database Schema

The full table-by-table schema, constraints, deletion rules, and ER diagram live in [Database schema reference](./docs/DATABASE_SCHEMA.md).

---

## Environment Variables

### Required Variables

| Variable                     | Description                                                    | How to Get                              |
| ---------------------------- | -------------------------------------------------------------- | --------------------------------------- |
| `NODE_ENV`                   | Environment (`development`, `production`)                      | Set locally or on host                  |
| `LOG_LEVEL`                  | Runtime log verbosity                                          | `info`                                  |
| `APP_KEY`                    | AdonisJS secure key for cookies and sessions                   | Run `node ace generate:key`             |
| `HOST`                       | Interface the server binds to                                  | `0.0.0.0` in containers                 |
| `DB_URL`                     | Supabase direct connection string                              | Supabase Dashboard -> Connect           |
| `DB_SSL`                     | Whether Postgres SSL should be enabled                         | `true` for Supabase                     |
| `DB_SSL_REJECT_UNAUTHORIZED` | Whether to reject untrusted cert chains                        | Often `false` on hosted platforms       |
| `AUTH_ISSUER_URL`            | ZITADEL issuer used for JWT validation                         | ZITADEL -> OpenID configuration         |
| `AUTH_ALLOWED_AUDIENCES`     | Required comma-separated accepted audiences                    | ZITADEL API/client configuration        |
| `AUTH_ROLE_CLAIM`            | Optional shared-project role claim override                     | ZITADEL project configuration           |
| `AUTH_DEBUG`                 | Enables verbose auth logging                                   | `true` only while debugging auth issues |
| `CORS_ALLOWED_ORIGINS`       | Exact comma-separated production browser origins                | `https://antirecurso.nei-isep.org`       |
| `SUPABASE_URL`               | Supabase project URL used by Storage REST API                  | Supabase Dashboard -> Project Settings  |
| `SUPABASE_SERVICE_ROLE_KEY`  | Server-side key for signing uploads/downloads and moving files | Supabase Dashboard -> API               |
| `SUPABASE_STORAGE_BUCKET`    | Bucket containing the uploaded and distribution note files     | Supabase Storage                        |
| `LIMITER_STORE`              | Shared limiter backend; use `database` in production             | `database`                              |

---

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

AdonisJS applications compile down to standard Node.js applications.

### 1. Build the Application

```bash
npm run build
```

This outputs the compiled code and required assets to the `build/` directory.

### 2. Install Production Dependencies

```bash
cd build
npm ci --omit=dev
```

### 3. Configure Production Environment

Provide your production environment variables through your deployment platform or runtime environment.
Ensure you set:

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `LOG_LEVEL=info`
- `APP_KEY=<your-secure-key>`
- `SESSION_DRIVER=cookie`
- `DB_URL=<Supabase direct connection string on port 5432>`
- `DB_SSL=true`
- `DB_SSL_REJECT_UNAUTHORIZED=false` unless strict certificate validation is known to work in your runtime

### Dockerfile-Based Deployment

This repository includes a production-ready `Dockerfile`, so a simple container-based deployment is:

1. Build and deploy the image from this repository's `Dockerfile`.
2. Expose the container on port `3333`.
3. Set the health check path to `/`.
4. Provide these environment variables:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3333
LOG_LEVEL=info
APP_KEY=generate-a-long-random-string
SESSION_DRIVER=cookie
DB_URL=postgresql://postgres:<password>@<host>:5432/postgres
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
RUN_MIGRATIONS=true
```

Notes:

- Use the **direct Supabase connection** on port `5432`, not the pooler on `6543`.
- `RUN_MIGRATIONS=true` is optional but useful on first deploy. The container entrypoint runs `node ace.js migration:run --force` before starting the server.
- Authentication is active and fail-closed: ZITADEL issuer, audience, signature, expiry, and AuthNEI roles are validated. Do not deploy without exact `AUTH_ALLOWED_AUDIENCES` and `CORS_ALLOWED_ORIGINS`.
- Use `LIMITER_STORE=database` so every replica shares rate-limit state.
- Deploy and verify this API and its migrations before a dependent Antirecurso web release.

### 4. Start the Application

```bash
npm run start
# or
node bin/server.js
```

---

## Troubleshooting

### Database Connection Failure on Startup

**Error:** AdonisJS logs a database connection failure during startup.

**Solution:**

1. Check your `.env` variables and ensure they match your Supabase instance.
2. Verify you are using the **Direct Connection Port (5432)** instead of the Connection Pooler port (6543).

### Prepared Statement Errors

**Error:** `prepared statement "..." already exists` or `named portals cannot be used in transaction mode`

**Solution:**
You are connecting to the Supabase PgBouncer pooler (port 6543) in transaction mode. Update `DB_URL` to use port `5432` to bypass the pooler and connect directly to PostgreSQL, as Lucid relies heavily on prepared statements.

### Missing SSL Connection Error

**Error:** `no pg_hba.conf entry for host ... SSL off`

**Solution:**
Supabase enforces SSL. Set `DB_SSL=true`. If your platform fails certificate validation against Supabase's chain, set `DB_SSL_REJECT_UNAUTHORIZED=false`.

## AuthNEI shared-project authorization

The API treats ZITADEL/AuthNEI as the source of truth for authorization. Bearer tokens must have a
valid signature, exact configured issuer, unexpired lifetime, and at least one audience from the
required `AUTH_ALLOWED_AUDIENCES` list. Only RSA `RS256`, `RS384`, and `RS512` signatures are
accepted.

Project roles are normalized to `student`, `nei_member`, `admin`, and `employee` from the standard
ZITADEL project-role claim (including project-ID claim variants). Authenticated application routes
require `student`; admin middleware and controller defense-in-depth checks require `admin` from the
validated token. The legacy database `is_admin` column remains temporarily for compatibility and
display of historical authors, but it no longer authorizes requests.

Set `AUTH_ROLE_CLAIM` only when the shared NEI Platform project emits a custom claim name. The
default is `urn:zitadel:iam:org:project:roles`.

## CI/CD gate

Every PR to `main` uses `npm ci` and must pass lint, typecheck, Japa tests, migrations against isolated PostgreSQL, production build and dependency audit, a non-root production Docker image, and Gitleaks. Green CI does not prove deployment: confirm the deployed SHA, migration status, `GET /`, exact CORS behavior, shared limits, storage promotion, and owner/admin boundaries after rollout.
