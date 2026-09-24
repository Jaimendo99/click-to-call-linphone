# AGENTS.md

AgenDial is an Express + `better-sqlite3` app with vanilla browser JS. No bundler, build step, linter, or migration CLI.

## Commands

- `npm start`: `node src/server.js`
- `npm run dev`: `node --watch src/server.js`
- `npm test`: `node --test tests/*.test.js`
- Focused test: `node --test tests/<name>.test.js`
- `npm run seed`: `scripts/seed-admin.js`; needs `ADMIN_PASSWORD`, creates the first admin only when `users` is empty

Use Node 22 (`.nvmrc`, Dockerfile `node:22-bookworm-slim`). `engines` says `>=20`, but 22 is the pinned runtime.

## Entrypoints

- `src/server.js` loads `.env` through `src/load-env.js` (hand-rolled parser, not `dotenv`), creates the app, bootstraps the first admin, listens on `PORT` (default 3000).
- `src/app.js` builds the Express app: mounts `/auth`, `/api/admin`, `/api/advisor`, serves `views/` HTML, `public/` assets, and `src/lib/` at `/lib`.
- `src/db.js` opens SQLite (WAL, foreign keys, busy timeout) and runs migrations inline. `src/schema.sql` is the idempotent baseline. There is no migration framework and no migration files beyond these two.
- `src/routes/` HTTP handlers. `src/lib/` domain logic. `public/js/` browser code. `views/` HTML. `tests/` Node test runner suite.

## Constraints

- One Node process per SQLite file. `better-sqlite3` is synchronous; the app relies on WAL plus a single writer. Do not add replicas or a second long-lived writer.
- `src/lib/phone.js` is served to browsers at `/lib/phone.js` and imported by `public/js/linphone.js`. Keep it browser-safe: no `node:*` imports, no `process`, no Node-only globals.
- Claiming and importing must stay prepared statements inside `db.transaction(...).immediate()` (`src/lib/claim.js`, `src/routes/admin.js`, `src/routes/advisor.js`). Deferred transactions reintroduce double assignment.
- API and UI copy is Spanish (`lang="es"`; call results in `src/lib/constants.js`). API errors are JSON `{ "error": "<Spanish message>" }` with a matching HTTP status.
- Each test file creates its own temp SQLite database through `tests/helpers.js` (`mkdtempSync`). Do not make tests share a database or server; the concurrency tests depend on separate connections.
- `docker-compose.yml` intentionally uses `expose: "3000"` with no host `ports:` mapping; Dokploy/Traefik routes the domain. Do not add a `ports:` mapping to make local access work; use `npm start` or `docker compose run --rm --build -p 3000:3000 web`.
