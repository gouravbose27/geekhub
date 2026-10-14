# GeekHub

A minimal GitHub-like app for hosting public Git repositories with owner-controlled collaboration.

## Requirements

- Node.js 20+
- `git` on `PATH` (`git http-backend` ships with Git for Windows and standard Git packages)

## Setup

```
npm install
npm run dev        # http://localhost:3000
npm test
npm run build && npm start
```

Configuration (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `GEEKHUB_DATA_DIR` | `./data` | SQLite file and `repos/<owner>/<name>.git` |
| `GEEKHUB_MAX_PUSH_BYTES` | `104857600` | Maximum push size |
| `NODE_ENV=production` | | Marks cookies `Secure`; serve behind HTTPS |

## Usage

1. Sign up, then create a repository at `/new`.
2. Create a personal access token at `/settings/tokens`.
3. Push, using the token as the password (any username):

   ```
   git remote add origin http://localhost:3000/<user>/<repo>.git
   git push -u origin main
   ```

4. Anyone can browse, view history and diffs, and clone without signing in.
5. The owner adds collaborators (push access) and can delete the repository from the repo's Settings tab.
