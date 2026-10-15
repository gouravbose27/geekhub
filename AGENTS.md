# AGENTS.md

General instructions for AI coding agents working in GeekHub. Role-specific agent instructions live in [docs/](docs/).

## Role-Specific Instructions (mandatory)

**Before making any code changes, you MUST read the relevant instruction file(s) in [docs/](docs/). This is non-negotiable.** If a task touches an area below, follow that file in addition to this one. If several apply, read all of them.

| Area | File | Applies to |
| --- | --- | --- |
| Front end | [docs/frontend.instructions.md](docs/frontend.instructions.md) | `src/views/`, `public/` (EJS, CSS, browser JS) |
| Back end | [docs/backend.instructions.md](docs/backend.instructions.md) | `src/` except `src/views/` (routes, auth, repos, git, db, config) |

Check `docs/` for any newly added instruction files before starting work.

## Project

GeekHub is a minimal GitHub-like app for hosting public Git repositories. See [PLAN.md](PLAN.md) for scope, data model, and permissions, and [README.md](README.md) for usage.

- Node.js 20+, TypeScript (ESM/CJS per `tsconfig.json`), Express 5
- SQLite via `better-sqlite3`
- Server-rendered EJS views, plain CSS (`public/`)
- System `git` CLI; bare repos under `data/repos/<owner>/<name>.git`, served via `git http-backend`

## Commands

- `npm run dev`: run with watch (`tsx watch src/server.ts`)
- `npm run build`: type-check and compile (`tsc`)
- `npm test`: run tests (`tsx --test test/*.test.ts`)

Run `npm run build` and `npm test` before considering a change done.

## Layout

- `src/auth/`: passwords, sessions, tokens, CSRF, validation, middleware
- `src/repos/`: repo CRUD, permissions, contributions, README rendering
- `src/git/`: `cli.ts` (git command wrappers), `httpBackend.ts` (CGI bridge)
- `src/routes/`: Express routers; `src/views/`: EJS templates
- `test/`: unit, permission, security, and integration tests
- `data/`: runtime state (SQLite, repos); never commit

## Coding Conventions

- Keep changes minimal and focused; don't refactor or add features beyond the request.
- Use strict TypeScript. Avoid `any`; type all exported functions.
- Match existing style, naming, and file organization. Prefer editing existing files over adding new ones.
- Keep route handlers thin; put logic in `auth/`, `repos/`, or `git/` modules.
- Comments only for non-obvious intent, one short line.
- Don't add dependencies without a clear need.

## Security (required)

- Authorization goes through the helpers in `src/repos/permissions.ts` (`canRead`, `canWrite`, `isOwner`). Never re-implement checks inline.
- Run git only via `execFile`/`spawn` with argument arrays; never build shell strings.
- Validate repo names (`^[A-Za-z0-9._-]{1,100}$`, reject `.` and `..`) and ensure resolved paths stay inside `data/repos`.
- Use parameterized SQL only; never interpolate user input.
- Escape output in EJS (`<%= %>`); sanitize rendered Markdown with `sanitize-html`.
- Keep CSRF protection on all state-changing forms, and rate limiting on auth endpoints.
- Store only hashes for passwords and access tokens; show token plaintext once.
- Never log secrets, tokens, or password hashes.

## Testing

- Add or update tests in `test/` for any behavior change, especially permissions and security.
- Use helpers in `test/helpers.ts`; tests must not touch the real `data/` directory.

## Git Workflow

- Don't commit, push, or run destructive git commands unless asked.
- Don't edit generated or runtime files (`dist/`, `data/`).
