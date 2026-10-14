# GeekHub: Implementation Plan (v1)

A minimal GitHub-like app for hosting public Git repositories with owner-controlled collaboration.

## Stack

- Node.js 20+, TypeScript, Express
- SQLite via `better-sqlite3`
- EJS server-rendered views, plain CSS
- System `git` CLI. Bare repos on disk, served through `git http-backend`

## Scope

**Included**
- Sign up, sign in, sign out (cookie sessions)
- Personal access tokens (credentials for `git push`)
- Create repositories (`git init --bare`)
- Public discovery and browsing for everyone, including anonymous users
- Clone/fetch for anyone; push only for the owner and collaborators
- Owner shares a repo with other users by username
- Change tracking in the UI: commit history, commit diffs, file view at any ref

**Excluded for v1**
- Pull requests, issues, forks, private repos, SSH, web editor/upload
- Email verification, password reset
- A custom version control tool (Git is used internally)

## Permissions

| Action | Anonymous | Signed-in user | Collaborator | Owner |
|---|---|---|---|---|
| Discover / browse / clone | yes | yes | yes | yes |
| Push | no | no | yes | yes |
| Share (manage collaborators) | no | no | no | yes |
| Delete repo | no | no | no | yes |

## Data Model

```sql
users(id, username UNIQUE, email UNIQUE, password_hash, created_at)
repositories(id, owner_id, name, description, created_at, UNIQUE(owner_id, name))
collaborators(repo_id, user_id, role DEFAULT 'write', PRIMARY KEY(repo_id, user_id))
access_tokens(id, user_id, token_hash, name, created_at, last_used_at)
sessions(id, user_id, expires_at)
```

## Planned Layout

```
geekhub/
├─ package.json, tsconfig.json
├─ src/
│  ├─ server.ts            # Express bootstrap
│  ├─ db.ts                # better-sqlite3 + migrations
│  ├─ auth/                # signup, login, sessions, tokens
│  ├─ repos/               # create, list, collaborators, permissions
│  ├─ git/
│  │  ├─ cli.ts            # execFile wrappers: log, show, ls-tree, diff
│  │  └─ httpBackend.ts    # git http-backend CGI bridge + auth check
│  ├─ routes/              # web pages and JSON routes
│  └─ views/               # EJS templates
├─ data/                   # gitignored: sqlite file + repos/<owner>/<name>.git
└─ test/                   # permission matrix + clone/push integration
```

## Phases

### Phase 1: Foundation
1. Initialize the project: `package.json`, `tsconfig.json`, scripts (`dev`, `build`, `test`), gitignored `data/`. Add `src/server.ts` (Express, EJS, body parsing, static assets).
2. Add `src/db.ts` with idempotent migrations for all tables, including unique constraints. *Depends on 1.*

### Phase 2: Authentication (depends on 2)
3. Sign up / sign in / sign out in `src/auth/`: password hashing, username/email validation, DB-backed sessions in an HttpOnly + SameSite cookie, CSRF protection on forms, rate limiting on login and signup.
4. Personal access tokens: create and revoke in settings. Show the plaintext once, store only the hash.
5. `requireAuth` and `optionalAuth` middleware. *Parallel with 4.*

### Phase 3: Repositories (depends on 2)
6. Create repo: validate the name against `^[A-Za-z0-9._-]{1,100}$` and reject `.` / `..`. Insert the row, run `git init --bare` at `data/repos/<owner>/<name>.git`, roll back the row on failure.
7. Permission helpers `canRead`, `canWrite`, `isOwner` as the single source of truth for authorization.
8. Discovery page (paginated, searchable) and owner-only delete.

### Phase 4: Git transport (depends on 5, 6, 7)
9. `src/git/httpBackend.ts`: mount `/:owner/:repo.git/*` and bridge to `git http-backend` (`GIT_PROJECT_ROOT`, `GIT_HTTP_EXPORT_ALL`, `PATH_INFO`, `REQUEST_METHOD`, `QUERY_STRING`, `CONTENT_TYPE`, `REMOTE_USER`). Stream the body in and parse CGI headers from the output.
10. Gate by service: `git-upload-pack` (clone/fetch) is open; `git-receive-pack` (push) requires Basic auth with a personal access token and `canWrite`. Return 401 with `WWW-Authenticate` for missing credentials and 403 when not authorized. Enforce a push size limit.
11. `src/git/cli.ts`: `execFile` wrappers (argument arrays, never shell strings) for `log`, `show`/`diff`, `ls-tree`, `cat-file`, and default-ref resolution. Handle empty repos. *Parallel with 9.*

### Phase 5: Browse and track changes (depends on 11)
12. Repo home: clone URL, file tree at the default branch, sanitized Markdown README.
13. `/tree/:ref/*`, `/blob/:ref/*` (escaped text, binary and large-file guard), `/commits` (paginated), `/commit/:sha` (diff). Validate `ref` and `sha` against a strict pattern before passing to Git.

### Phase 6: Sharing (depends on 7)
14. Owner-only collaborators page: add by username, remove, list. Add a "Shared with you" section to the dashboard.

### Phase 7: Hardening and tests (depends on all above)
15. Global error handler, security headers (`helmet`), body-size limits, path-traversal checks (resolved repo paths must stay under `data/repos`).
16. Write the tests listed under Verification and a README with setup and usage.

## Verification

1. **Permission matrix test:** anonymous, non-collaborator, collaborator, and owner against read, push, share, and delete.
2. **Integration test:** start the server on a temp `data/` dir, create a user, repo, and token, then `git clone`, commit, and `git push` with the token. Confirm the commit appears at `/commits`.
3. **Negative tests:** push without a token returns 401, push as a non-collaborator returns 403, and push succeeds after the owner adds that user as a collaborator.
4. **Security tests:** repo names like `../x`, `a/b`, `x.git`; refs starting with `-`; script tags in README, filenames, and commit messages must be rejected or escaped.
5. **Manual check:** sign up two users, share a repo from A to B, confirm B can push and A sees B's commits and diffs in the UI.
6. `npm run build` and `npm test` pass with no TypeScript errors.

## Decisions

- Only the repo owner can share, delete, or manage collaborators. Collaborators have push access only.
- The default branch is whatever the user pushes; the UI resolves the repo's `HEAD`.
- Prerequisites: Node 20+ and `git` on `PATH` (`git http-backend` ships with Git for Windows).

## Open Considerations

1. **Password hashing:** `bcryptjs` (pure JS, easy on Windows) is recommended; argon2 needs native compilation and can be swapped in later.
2. **Email:** collect at sign-up, skip verification in v1.
3. **Frontend:** server-rendered EJS with plain CSS; React/Vite is an option later.
