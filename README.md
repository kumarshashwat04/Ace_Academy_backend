# ACE Academy Backend

REST API for reading data from the `ace_academy` PostgreSQL database (hosted on
the VM at `172.35.0.13`).

Built with **Node.js + Express + TypeScript** and the `pg` driver. The design is
a **generic reusable core + one module per table**, so adding endpoints for a new
table means creating one small module — not rewriting any plumbing.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the real DB credentials
```

### Environment variables

| Variable                    | Description                                  | Default       |
| --------------------------- | -------------------------------------------- | ------------- |
| `PORT`                      | HTTP port                                    | `3000`        |
| `NODE_ENV`                  | `development` / `production`                 | `development` |
| `CORS_ORIGIN`               | Allowed origin(s), comma-separated, or `*`   | `*`           |
| `DB_HOST`                   | PostgreSQL host                              | `172.35.0.13`  |
| `DB_PORT`                   | PostgreSQL port                              | `5432`        |
| `DB_NAME`                   | Database name                                | `ace_academy` |
| `DB_USER`                   | DB user                                      | —             |
| `DB_PASSWORD`               | DB password                                  | —             |
| `DB_SSL`                    | Use SSL for the connection (`true`/`false`)  | `false`       |
| `DB_POOL_MAX`               | Max pooled connections                       | `10`          |
| `DB_IDLE_TIMEOUT_MS`        | Idle client timeout                          | `30000`       |
| `DB_CONNECTION_TIMEOUT_MS`  | Connection acquire timeout                   | `10000`       |

## Running

```bash
npm run dev         # hot-reload dev server (tsx watch)
npm run build       # compile TypeScript to dist/
npm start           # run the compiled build
npm run typecheck   # type-check without emitting
npm run introspect  # list all DB tables + columns (needs real .env creds)
```

## Endpoints

- `GET /health` — liveness + DB connectivity (`{ status, db }`)

One pair of read endpoints per table (`courses`, `levels`, `modules`, `topics`, `resources`):

- `GET /api/<table>` — list rows, with query params:
  - `limit` (1–100, default 25), `offset` (default 0)
  - `sort=<column>`, `order=asc|desc`
  - any column name as an equality filter, e.g. `GET /api/levels?course_id=42`
- `GET /api/<table>/:id` — single row by primary key (404 if not found)

List responses are shaped as:

```json
{ "data": [ ... ], "pagination": { "total": 42, "limit": 25, "offset": 0 } }
```

## Project structure

```
src/
├── server.ts            # boot + graceful shutdown
├── app.ts               # Express app: middleware, /health, /api, error handling
├── config/              # typed, validated env config
├── db/                  # pg pool + query() helper (all SQL goes through here)
├── core/                # BaseRepository (generic safe reads), createResourceRouter, ApiError, asyncHandler
├── middleware/          # errorHandler, notFound
├── routes/              # mounts every module router under /api
├── modules/<table>/     # ONE file per table: <table>.module.ts
└── scripts/introspect.ts
```

`BaseRepository` discovers each table's columns and primary key from the
PostgreSQL catalog on first use, so a module only needs to name its table.

## How to add a new table

1. (Optional) `npm run introspect` to see the table's columns and primary key.
2. Create `src/modules/<table>/<table>.module.ts`:
   ```ts
   import { BaseRepository } from "../../core/BaseRepository";
   import { createResourceRouter } from "../../core/createResourceRouter";

   export const myTableRepository = new BaseRepository("my_table");
   export default createResourceRouter(myTableRepository, "MyTable");
   ```
   To restrict which columns are exposed, pass `{ columns: ["id", "name"] }`.
3. Register it in [src/routes/index.ts](src/routes/index.ts):
   ```ts
   import myTableRoutes from "../modules/my_table/my_table.module";
   apiRouter.use("/my_table", myTableRoutes);
   ```

When a table needs custom logic (joins, derived fields, auth), replace the
factory call with explicit handlers and add `service`/`controller` files.

## Security notes

- All user-supplied **values** are bound as parameters (`$1, $2, …`) — never
  string-interpolated into SQL.
- SQL **identifiers** (column names used in sort & filter) can't be
  parameterized, so they're validated against the table's catalog-derived
  column set and double-quoted in [src/core/BaseRepository.ts](src/core/BaseRepository.ts).
- `helmet` sets secure HTTP headers; `cors` restricts origins via `CORS_ORIGIN`.
# Ace_Academy_backend
