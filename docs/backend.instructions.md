# Back End Instructions

Coding standards for GeekHub's back end: Express 5 routes, SQLite data access, auth, and the Git layer. Complements [AGENTS.md](../AGENTS.md).

## Stack

- Node.js 20+, strict TypeScript, Express 5, `better-sqlite3` (synchronous), system `git` CLI.
- Entry points: `src/server.ts` (listen), `src/app.ts` (app wiring), `src/config.ts` (env config), `src/db.ts` (schema/connection).
- Don't add dependencies, ORMs, or frameworks without a clear need.

## Layering

- `src/routes/`: thin Express routers. Parse and validate input, call a domain module, render a view or redirect. No SQL, no git commands, no business rules.
- `src/auth/`: passwords, sessions, tokens, CSRF, validation, middleware.
- `src/repos/`: repo CRUD, collaborators, permissions, contributions, README rendering.
- `src/git/`: `cli.ts` (git command wrappers) and `httpBackend.ts` (CGI bridge). All git access goes here.
- Modules receive dependencies (`db`, `reposDir`) as arguments, as in `repoRouter(db, opts)`. Don't create global singletons.
- Export typed functions and interfaces; no `any`.

## Routes

- Routers are factories: `export function xRouter(db: DB, opts): Router`.
- Protect routes with `requireAuth` and the permission helpers; load the resource first and return the same 404 page for missing and unauthorized-to-view resources.
- Treat every `req.params`, `req.query`, and `req.body` value as `unknown`: coerce with helpers (`str`, `pageParam`) and validate before use.
- Bound pagination and sizes (see `COMMITS_PER_PAGE`, `MAX_README_BYTES`, `MAX_BLOB_VIEW_BYTES`).
- Redirect after successful POST; re-render the form with a message and appropriate status on validation failure.
- Don't leak internals: error pages show generic messages; log details server-side without secrets.
- Async handlers must not leave rejected promises unhandled; Express 5 forwards them to the error handler.

## Database

- Parameterized statements only (`db.prepare('... ? ...').get(...)`); never interpolate user input.
- Schema changes go through `src/db.ts`, idempotent and backward compatible with existing `data/` databases.
- Multi-step writes (create repo + row, delete + cleanup) use transactions; keep filesystem and DB state consistent on failure.
- Add indexes and `UNIQUE` constraints for lookups and invariants; also handle the constraint error in code (e.g. `RepoExistsError`).
- Store timestamps and ids consistently with existing tables.

## Authorization and Auth

- Use only `canRead`, `canWrite`, `isOwner` from `src/repos/permissions.ts`. Never re-implement checks inline.
- Passwords hashed via `src/auth/password.ts`; sessions, tokens, and reset tokens store only hashes. Show token plaintext once.
- Compare secrets in constant time; generate them with `node:crypto`.
- State-changing routes require CSRF validation; auth endpoints keep rate limiting.
- Session cookies: `httpOnly`, `sameSite`, `secure` in production.
- Never log passwords, tokens, hashes, or cookies.

## Git Layer

- Run git only with `execFile`/`spawn` and argument arrays; never shell strings.
- Validate user-supplied refs, SHAs, and paths with `isValidRef`, `isValidSha`, `normalizePath` before passing to git. Reject values that look like options or revision syntax.
- Repo names: `^[A-Za-z0-9._-]{1,100}$`, reject `.` and `..`. Resolve paths with `repoPath` and ensure they stay inside `data/repos`.
- Cap output size and report truncation; set `GIT_TERMINAL_PROMPT=0`.
- Throw `GitError` for git failures and map it to a user-facing message in the route.
- Smart HTTP goes through `git http-backend` in `src/git/httpBackend.ts`; enforce read/write permission before spawning it, and authenticate pushes with tokens or sessions.

## Errors and Config

- Use typed error classes for expected failures; catch them in routes and map to status codes.
- Read environment variables only in `src/config.ts`; provide safe defaults and don't hard-code paths or secrets.
- Runtime state lives in `data/`; never write elsewhere or commit it.

## Verification

- Add or update tests in `test/` for every behavior change, especially permissions, validation, and path/ref handling. Use `test/helpers.ts`; never touch the real `data/`.
- Run `npm run build` and `npm test`.
