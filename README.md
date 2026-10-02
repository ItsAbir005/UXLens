# UXLens Phase 1

Manual local development foundation:

```text
UXLens
|- frontend    React + Vite
|- backend     Node.js + Express + Prisma
|- mcp-server  Node.js + MCP SDK
`- PostgreSQL  local development database
```

The Prisma schema intentionally contains only `Project`. Sessions, events, and UX problems belong to a later phase.

## Requirements

- Node.js 22 or newer
- npm
- PostgreSQL running locally

Create `backend/.env` with your local database connection:

```env
DATABASE_URL="postgresql://uxlens:uxlens@localhost:5432/uxlens?schema=public"
DIRECT_URL="postgresql://uxlens:uxlens@localhost:5432/uxlens?schema=public"
```

For Supabase, set `DATABASE_URL` to the pooler URL for the running app and `DIRECT_URL` to the direct/session connection URL for Prisma migrations. Create the database and user before running migrations.

## Install

From the repository root:

```powershell
npm --prefix backend install
npm --prefix frontend install
npm --prefix mcp-server install
```

## Start manually

Run each service in its own terminal from the repository root.

Backend:

```powershell
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate
npm --prefix backend run dev
```

Frontend:

```powershell
npm --prefix frontend run dev
```

MCP server:

```powershell
npm --prefix mcp-server start
```

Services:

- Frontend: http://localhost:3000
- Backend: http://localhost:4000/health
- MCP server: http://localhost:5000/mcp
- PostgreSQL: localhost:5432

The backend health route performs a Prisma `project.count()` query. Application routes use Prisma Client; they do not use raw SQL.

## MCP tools

The MCP server exposes `ping` and `get_latest_workflow`. The latter accepts `owner` and `repo` and reads the latest GitHub Actions run. Set `GITHUB_TOKEN` in `mcp-server/.env` for private repositories or higher GitHub API limits.

## Database

The Prisma schema lives at `backend/prisma/schema.prisma`, the connection is configured in `backend/prisma.config.ts`, and migrations are tracked under `backend/prisma/migrations`.
