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

To connect to your **Supabase PostgreSQL** instance, ensure you configure the direct connection (usually port `5432` rather than `6543`) in your `.env` file:

| Variable      | Description                     | Example                 |
| ------------- | ------------------------------- | ----------------------- |
| `PORT`        | Application Port                | `3333`                  |
| `NODE_ENV`    | Application environment         | `development`           |
| `DB_HOST`     | Supabase PostgreSQL host        | `aws-0-eu-central-1...` |
| `DB_PORT`     | Supabase direct connection port | `5432`                  |
| `DB_USER`     | Supabase database user          | `postgres`              |
| `DB_PASSWORD` | Supabase database password      | `your-secure-password`  |
| `DB_DATABASE` | Supabase database name          | `postgres`              |

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
- **SSL configuration is environment-aware**. Supabase requires SSL connections. In `config/database.ts`, it conditionally rejects unauthorized connections based on the environment (e.g., `ssl: env.get('NODE_ENV') === 'production' ? { rejectUnauthorized: true } : undefined`).
- **Connection Mode**: Supabase provides both a _Direct Connection_ (port 5432) and a _Connection Pooler_ (port 6543, using PgBouncer in transaction mode). Because Lucid/Knex uses prepared statements by default (which transaction-mode PgBouncer does not support), **the direct connection (port 5432) is required and recommended**.

**Authentication (WIP)**

- Authentication relies on `@adonisjs/auth`. Note that the integration relies on standard Adonis mechanisms (and custom user tables) rather than integrating with external Supabase Auth.

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
| `APP_KEY`     | AdonisJS secure key for cookies and sessions | Run `node ace generate:key`                |
| `DB_HOST`     | Supabase host                                | Supabase Dashboard -> Database -> Settings |
| `DB_PORT`     | Supabase direct port (5432)                  | Supabase Dashboard                         |
| `DB_USER`     | Postgres user                                | Default is `postgres`                      |
| `DB_PASSWORD` | Postgres password                            | Set during Supabase project creation       |
| `DB_DATABASE` | Database name                                | Default is `postgres`                      |

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

Provide your production environment variables (e.g., via your PaaS dashboard like Render, Railway, or Fly.io).
Ensure you set:

- `NODE_ENV=production`
- `APP_KEY=<your-secure-key>`
- All `DB_*` Supabase credentials. Ensure `DB_PORT` is set to `5432` for direct connection.

_Note: In production mode, the application will automatically strictly enforce SSL on the database connection._

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
You are connecting to the Supabase PgBouncer pooler (port 6543) in transaction mode. Update `DB_PORT` to `5432` to bypass the pooler and connect directly to PostgreSQL, as Lucid relies heavily on prepared statements.

### Missing SSL Connection Error

**Error:** `no pg_hba.conf entry for host ... SSL off`

**Solution:**
Supabase enforces SSL. Ensure `NODE_ENV` is set to `production` to trigger the `rejectUnauthorized: true` flag in `config/database.ts`, or manually pass the SSL configuration to the pg connection in development if required.
