# Antirecurso API

A robust backend API built with AdonisJS 6 for the Antirecurso platform. It provides RESTful endpoints to manage users, subjects, questions, exams, notes, comments, and scores, persisting all data to a Supabase-hosted PostgreSQL database.

## Key Features

- **Subject & Question Management**: Endpoints for retrieving, creating, and updating subjects, question types, and multiple-choice options.
- **Exams System**: Generate practice exams, verify answers, and track user scores.
- **Notes & Comments**: Allow users to upload, view, and comment on educational materials.
- **User Engagement**: Track scores, answer history, and content likes.
- **Health Check**: Native `/` endpoint to instantly verify application status and database connectivity at startup.

---

## Tech Stack

- **Language**: TypeScript
- **Framework**: AdonisJS 6
- **Database**: PostgreSQL 15+ (hosted on Supabase)
- **ORM**: Lucid ORM
- **Validation**: VineJS
- **Authentication**: @adonisjs/auth (Pending full integration)
- **Testing**: Japa
- **Linting & Formatting**: ESLint and Prettier

---

## Prerequisites

- Node.js 20 or higher
- `npm` (or `pnpm`/`yarn`)
- A **Supabase** account to host the PostgreSQL database instance.

---

## Getting Started

### 1. Clone the Repository

```bash
git clone <your-repository-url>
cd antirecurso-api-adonis
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Setup

Copy the example environment file to create your local `.env`:

```bash
cp .env.example .env
```

To connect to your **Supabase PostgreSQL** instance, ensure you configure the direct connection string (port `5432`, not `6543`) in your `.env` file:

| Variable      | Description                     | Example                 |
| ------------- | ------------------------------- | ----------------------- |
| `PORT`        | Application Port                | `3333`                  |
| `NODE_ENV`    | Application environment         | `development`           |
| `DB_URL`      | Supabase direct Postgres connection string | `postgresql://postgres:...@db.xxx.supabase.co:5432/postgres` |
| `DB_SSL`      | Enable SSL for Postgres         | `true`                  |
| `DB_SSL_REJECT_UNAUTHORIZED` | Require full certificate validation | `false` |
| `SUPABASE_URL` | Supabase project URL for Storage API | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key used server-side for Storage operations | `eyJ...` |
| `SUPABASE_STORAGE_BUCKET` | Private bucket that stores note PDFs | `notes` |

### 4. Database Setup

Once your `.env` file is populated with the Supabase credentials, execute all the existing migrations to materialize the schema:

```bash
node ace migration:run
```

This will create 13 tables: `users`, `subjects`, `question_types`, `questions`, `options`, `answers`, `answer_questions`, `comments`, `scores`, `question_reports`, `password_reset_codes`, `notes`, and `likes`.

You can verify the status of the migrations at any time using:

```bash
node ace migration:status
```

### 5. Start Development Server

Run the AdonisJS development server with Hot Module Replacement (HMR) enabled:

```bash
npm run dev
```

Open [http://localhost:3333](http://localhost:3333) in your browser. You should receive a JSON response `{ "status": "ok" }`, confirming end-to-end data flow and startup connectivity.

---

## Architecture

### Directory Structure

```text
├── app/
│   ├── controllers/      # Route controllers (Exams, Notes, Users, Subjects, etc.)
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

**Authentication (WIP)**

- Authentication relies on `@adonisjs/auth`. Note that the integration relies on standard Adonis mechanisms (and custom user tables) rather than integrating with external Supabase Auth. Route-level auth wiring is still intentionally left as TODO in the codebase.

### Database Schema

```text
users                  (Core users table)
password_reset_codes   (Auth recovery)
subjects               (Educational subjects)
question_types         (Types of questions)
questions              (Exam questions mapping to subjects)
options                (Multiple choice options for questions)
answers                (User submitted answers)
answer_questions       (Junction table for answers and questions)
comments               (User comments on questions/subjects)
scores                 (User exam scores tracking)
question_reports       (User reports on faulty questions)
notes                  (Study materials and notes)
likes                  (User likes on notes/comments)
```

---

## Environment Variables

### Required Variables

| Variable      | Description                                  | How to Get                                 |
| ------------- | -------------------------------------------- | ------------------------------------------ |
| `NODE_ENV`    | Environment (`development`, `production`)    | Set locally or on host                     |
| `LOG_LEVEL`   | Runtime log verbosity                        | `info`                                    |
| `APP_KEY`     | AdonisJS secure key for cookies and sessions | Run `node ace generate:key`                |
| `HOST`        | Interface the server binds to                | `0.0.0.0` in containers                    |
| `DB_URL`      | Supabase direct connection string            | Supabase Dashboard -> Connect              |
| `DB_SSL`      | Whether Postgres SSL should be enabled       | `true` for Supabase                        |
| `DB_SSL_REJECT_UNAUTHORIZED` | Whether to reject untrusted cert chains | Often `false` on hosted platforms          |
| `SUPABASE_URL` | Supabase project URL used by Storage REST API | Supabase Dashboard -> Project Settings     |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side key for signing uploads/downloads and moving files | Supabase Dashboard -> API                  |
| `SUPABASE_STORAGE_BUCKET` | Bucket containing the uploaded and distribution note files | Supabase Storage                           |

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

Provide your production environment variables (e.g., via your PaaS dashboard like Coolify, Render, Railway, or Fly.io).
Ensure you set:

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `LOG_LEVEL=info`
- `APP_KEY=<your-secure-key>`
- `SESSION_DRIVER=cookie`
- `DB_URL=<Supabase direct connection string on port 5432>`
- `DB_SSL=true`
- `DB_SSL_REJECT_UNAUTHORIZED=false` unless strict certificate validation is known to work in your runtime

### Coolify

This repository includes a production-ready `Dockerfile`, so the simplest Coolify setup is:

1. Create a new **Application** from your Git repository.
2. Select **Dockerfile** as the build pack.
3. Set the **Port** to `3333`.
4. Set the health check path to `/`.
5. Add these environment variables in Coolify:

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
- Authentication is still intentionally left as TODO in the codebase. This deployment only wires the API runtime and Supabase database connection.

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
