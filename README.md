# TimeFlex

TimeFlex is an enterprise education scheduling platform for AI-assisted and manual timetable generation.
This MVP covers the PRD's first slice: **one college department timetable**, set up by a timetable
coordinator in plain words (parsed by a small local model) or by hand, then solved with OR-Tools.

## Pilot install (Docker)

One command brings up PostgreSQL, the solver, the local model (Ollama + qwen3:0.6b), the app and nightly
backups. Full steps, backups and troubleshooting are in [docs/PILOT_RUNBOOK.md](docs/PILOT_RUNBOOK.md).

```bash
cp .env.example .env          # set POSTGRES_PASSWORD
docker compose up -d --build  # app at http://localhost:3001
docker compose exec app node apps/api/src/cli/seed.js   # optional demo department
```

## Quick start (development)

Needs Node 20+ and Python 3.11+. Ollama is optional.

```bash
npm install
npm run setup        # creates the solver virtualenv, checks for Ollama
ollama pull qwen3:0.6b   # optional, ~520 MB; enables AI quick setup
npm run dev          # solver :8000, API :3001, web http://localhost:5173
```

The pilot runs on PostgreSQL: set `DATABASE_URL=postgres://user:pass@localhost:5432/timesflex` and the API
creates and migrates its tables on start. Without it, the API falls back to a JSON file
(`apps/api/data/timesflex.json`), which is fine for a quick demo.

### Accounts and roles

The first time you open the app it asks you to create the **owner** account. TimeFlex is single-owner:

| Role | Can do |
|---|---|
| Admin | Set up the institution, teachers, rooms and subjects; generate, edit and approve timetables; manage users |
| Viewer | Browse timetables and export them as Excel or PDF |

Admins add viewer accounts for staff under **Users**. Approved timetables are locked until an admin unapproves them.
Sign-ins, user changes, saves, generations and approvals are written to an audit log that admins see as
**Recent activity** on the Users page.
If you lose the admin password, reset it from the server:

```bash
npm run admin -w @timesflex/api -- owner   # prompts for a new password; creates the user if missing
```

For a single-port setup, run `npm run build` and start only the API: it serves the built web app at
http://localhost:3001.

## Workspace layout
- `apps/web`: React frontend for setup, generation, and editing
- `apps/api`: Node.js API for institutions, timetable versions, chat parsing, and solver orchestration
- `services/solver`: Python scheduling engine using OR-Tools CP-SAT
- `docs`: Product, stack, design, and roadmap docs
- `scripts`: `setup`, `dev` and test runners (no extra dependencies)

## The coordinator's flow
1. **Dashboard**: create an institution, or reopen one with its timetable versions.
2. **Quick setup (AI)**: describe the department in plain text. The local model returns a draft that you review
   (remove anything wrong, read the warnings), then merge into the profile. Nothing is saved before you accept.
3. **Setup tabs**, all editable in place:
   - **Institution**: working days, hours, period length, break.
   - **Structure**: department, then year/semester, divisions with student counts, and lab batches.
   - **Teachers**: daily/weekly limits, whether they handle labs, and a day x slot availability grid
     (click a cell for *preferred*, again for *unavailable*). Shows each teacher's assigned load against capacity.
   - **Rooms & Labs**: type, seats, lab equipment/software, and closed times.
   - **Subjects**: teacher, room (or *auto*), sessions per week, block length, which divisions take it,
     a different teacher per division, and a *heavy* flag.
4. **Generate**: the solver places every session it can and explains anything it cannot. Views: all classes,
   all labs, each class, each lab batch, each teacher, each room. Drag a session to move it, double-click to lock
   it, regenerate the rest. Every generation is a stored **version**; approve the one you want.
5. **Export** the current view, or every class / batch / teacher / room, as **Excel (.xlsx)** with one sheet per
   timetable, or **PDF** with one landscape page per timetable. Print is also styled.

## Constraints enforced
Hard constraints, enforced by the solver and re-checked live after manual edits:
- no teacher, room, division or batch double-booking (batches of one division may run labs in parallel)
- labs and other multi-slot sessions never straddle a break or run past the end of the day
- teacher daily and weekly lecture limits, unavailable days and unavailable slots
- rooms: labs only in labs and lectures only in classrooms/halls when the room is *auto*; the room must seat the
  class (a lab batch is the division size split across its batches); closed times are respected
- locked sessions keep their day, slot and room on regeneration

Soft preferences: spread each subject across the week, spread heavy subjects so a class gets few per day,
keep teachers in their preferred slots, balance daily load per division and per teacher, prefer earlier slots.
When a timetable cannot be complete, the result is partial rather than empty, with reasons such as
*"Prof. Mehta is assigned 16 slots/week but can teach at most 12"* or *"No lab seating 35 is available for
Physics Lab (FE-A)"*.

### MVP scope (from `docs/PRD.md`)
| PRD item | Where |
|---|---|
| Institution name, type, days, hours, breaks | Institution tab |
| Department -> year/semester -> division -> batch | Structure tab |
| Teachers: subjects, classes, limits, availability, preferred slots, lab capability | Teachers + Subjects tabs |
| Rooms: capacity, type, availability windows, subject eligibility, lab equipment | Rooms & Labs + Subjects tabs |
| Class, teacher, room (and batch, lab) timetables | Generate tab views |
| Lab-aware scheduling, break enforcement, conflict detection | Solver + live checker |
| Manual moves, locks, regenerate with locks kept | Generate tab |
| Chat setup with review before apply | Quick setup tab |
| PDF and Excel export | Generate tab |

Not in this MVP: sign-in and roles (single coordinator, local), exams, substitutions, multi-campus.

## Local AI (small open-weight models)
Quick setup runs fully offline against a small model. The default is **Qwen3 0.6B** via Ollama.

Tiny models get structure right but make predictable mistakes: they copy one teacher's limits onto another,
drop items from long lists, and echo the prompt's example. The parser is therefore a hybrid
(`apps/api/src/parser.js`):

1. **One model call** with a flat JSON schema enforced by constrained decoding (`format` in Ollama,
   `response_format: json_schema` elsewhere), temperature 0, thinking disabled.
2. **Deterministic rules** for regular patterns: working days and hours, period and break length,
   "X teaches Y 3 times a week in Room Z", "Subject is taught by X", "Divisions A (batches A1, A2)".
   Rule matches fill gaps and override the model.
3. **Sentence-local grounding**: a teacher's limits and days off are kept only if they appear in a
   sentence that names that teacher, and numbers must sit next to their unit. Any name that does not
   occur in the text is dropped with a warning.
4. If no model is reachable, the rules alone produce the draft, and the UI says so.

On an internal set of 7 descriptions (83 checks), on a laptop CPU:

| Setup | Accuracy | Time per parse |
|---|---|---|
| Qwen3 0.6B + hybrid | 100% | ~6 s |
| Qwen3 1.7B + hybrid | 96–98% | ~20 s |
| Rules only, no model | 91% | instant |

The rules were tuned on these descriptions. On two descriptions written before any tuning, both models
scored 80%, so expect occasional misses on unfamiliar phrasing. That is why every draft goes through review.

| Variable | Default | Notes |
|---|---|---|
| `AI_PROVIDER` | `ollama` | `ollama`, `openai` (LM Studio, llama.cpp `llama-server`, vLLM) or `off` |
| `AI_BASE_URL` | `http://127.0.0.1:11434` | `http://127.0.0.1:1234/v1` is the default for `openai` |
| `AI_MODEL` | `qwen3:0.6b` | e.g. `qwen3:1.7b` for messier notes |
| `AI_TIMEOUT_MS` | `120000` | first call also loads the model |
| `DATABASE_URL` | unset | PostgreSQL connection string; unset uses the JSON file store |
| `SOLVER_URL` | `http://127.0.0.1:8000/solve` | |
| `SOLVER_TIMEOUT_MS` | `150000` | the API gives up on a solve after this |
| `COOKIE_SECURE` | `false` | set `true` when the app is served over HTTPS |
| `CORS_ORIGINS` | unset | comma-separated extra origins; same-origin needs none |
| `WEB_DIST` | `apps/web/dist` | built web app the API serves |
| `LOG_REQUESTS` | `true` | one line per API request on stdout; `false` silences it |

Put these in a `.env` file at the repo root (copy `.env.example`); the API and the admin CLI load it on start.

### Demo department and backups

`npm run seed -w @timesflex/api` adds **Demo Institute of Technology**, a fictional Computer Engineering
department (4 divisions, 8 teachers, 12 subjects) that generates a complete 64-session week. Running it
again changes nothing.

`node scripts/backup.mjs` saves a backup into `backups/` (pg_dump for PostgreSQL, a copy of the JSON file
otherwise) and keeps the newest 14; `node scripts/backup.mjs --restore <file>` puts one back.

## Tests
```bash
npm test             # API route, auth, store and parser tests; web logic + export tests; solver tests (pytest)
TEST_DATABASE_URL=postgres://... npm test   # also runs the store tests against a throwaway PostgreSQL database
npm run typecheck
```
