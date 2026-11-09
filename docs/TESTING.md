# Testing

New features start with a failing test. Everything below runs with one command, in Docker, on a real throwaway
PostgreSQL that never touches live data:

```bash
npm run test:docker
```

| Layer | Where | What it proves |
|---|---|---|
| **Unit** | `packages/core/test` | Timetable logic, changes, structure and student records, with no server. |
| **Integration** | `apps/api/test/roles.test.js`, `platform.test.js`, `notices.test.js`, `auth.test.js` | Real HTTP against the real API: who can do what, and every permission boundary. The first three also run on PostgreSQL. |
| **White box** | `apps/api/test/whitebox.test.js` | Written from the code and coverage report, to reach branches normal use doesn't: outside services failing, limits, races and operator scripts. A coverage floor fails the run if it drops. |
| **Solver** | `services/solver/tests` | Hard rules are never broken, and large colleges come back complete. |
| **End to end** | `scripts/e2e.mjs`, `scripts/e2e-roles.mjs` | A real browser against a running server, on desktop and phone sizes, for each role. |
| **Security** | `scripts/security-check.mjs` | Attacks a server you own: other colleges' data, injection, floods, forged webhooks. |

Run the last two against a running server:

```bash
APP_URL=http://localhost:8080 node scripts/e2e.mjs
APP_URL=http://localhost:8080 node scripts/e2e-roles.mjs
# Last: it floods sign-ups on purpose, so other tests that sign up are refused for an hour unless the API restarts.
TARGET=http://localhost:8080 npm run test:security
```

To include the central admin in `e2e-roles.mjs`, set `PROMOTE_COMMAND`, with `{email}` where the address goes:

```bash
PROMOTE_COMMAND='docker compose exec -T api node src/make-central-admin.js {email}' APP_URL=http://localhost:8080 node scripts/e2e-roles.mjs
```

For a change to permissions, add a line to the "teachers can't reach" list in `roles.test.js`. New admin routes
should use `ownedInstitution`, which refuses teachers by default.
