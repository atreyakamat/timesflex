# TimeFlex

TimeFlex plans a college department's timetable together with the faculty member who usually does it alone.
You set it up by answering a friendly assistant (or in plain words, read by a small local model), it builds
several clash-free versions with OR-Tools, explains every choice, and learns which kind of week you prefer.

There are two front ends:
- **`apps/mobile`: the app** (React Native + Expo) for **Android, iOS and the web**. This is the main product.
- `apps/web`: the earlier web app (React + Vite), kept working until the app covers everything it does.

## Quick start

Needs Node 20+ and Python 3.11+. Ollama is optional.

```bash
npm install
npm run setup            # solver virtualenv, app dependencies, checks for Ollama
ollama pull qwen3:0.6b   # optional, ~520 MB; lets the assistant understand free-form requests
npm run dev              # solver :8000, API :3001 (and the older web app on :5173)
npm run app              # the app in the browser (Expo, http://localhost:8081)
```

On a phone: install **Expo Go**, run `npm run app:android` or `npm run app:ios` (or `npm run app` and scan the
QR code); the phone must be on the same network, and the app finds the API on the computer running Expo.
Set `EXPO_PUBLIC_API_URL` to point it elsewhere. Store builds (APK / IPA) are made with `eas build` or Android
Studio / Xcode from `apps/mobile`; nothing in this repository needs them to run.

No database setup is needed: without `DATABASE_URL` the API stores data in `apps/api/data/timesflex.json`.
Set `DATABASE_URL=postgres://user:pass@localhost:5432/timesflex` to use PostgreSQL instead.

## The app, screen by screen
- **Welcome**: what TimeFlex does, with an animated 3D stack of timetable cards; light, dark or automatic theme.
- **Sign up**: one account per department (institution name and type, your name, e-mail, password).
- **Onboarding**: a chat with the assistant. It asks one thing at a time (days, hours, periods, break,
  department), then you add classes, teachers (with expertise), rooms and subjects one by one, with suggested
  next names ("SE-B", "Room 102") and starred teachers whose expertise matches a subject. It then checks the
  setup, offers one-tap fixes, and builds three versions to compare. Or: describe it in your own words, or
  explore with sample data.
- **Home**: today at a glance, *What I noticed* (problems and tips, each with a fix), *Your taste* (what it has
  learned), and department stats.
- **Timetable**: by class, teacher or room; a week grid on wide screens, day by day on phones. Tap a class to see
  **why it is there** and the times it could move to without a clash or breaking a limit; lock it. Build new
  versions in any style (balanced, compact days, even spread, fewer teacher days, late start, *your style*),
  compare them side by side, choose one, approve.
- **Assistant** (the chat button everywhere): type what changed, e.g. "Mehta is on leave Monday to Wednesday",
  "max 3 a day for Rao", "add lab 3 with 32 seats", "make 3 variations". It always shows exactly what it will
  change and waits for *Apply*.
- **Today**, **Cover** (mark who is away, auto-assign fair substitutes, share on WhatsApp), **Attendance**,
  **Setup** editors and a **profile for every teacher**.

## How the intelligence works
All of it is plain TypeScript in `packages/core`, tested, and shared by both front ends.
- **Insights** (`insights.ts`): checks the setup and the timetable (overloaded teachers, subjects without a
  teacher, missing or too-small rooms, overfull weeks, idle gaps, late periods) and attaches a fix to each.
- **Explanations** (`explain.ts`): rebuilds why a session sits where it does from the finished timetable, and
  lists legal alternatives.
- **Agent** (`agent.ts`, `command.ts`): instructions become a list of actions. Common phrasings are read by rules,
  offline and instantly; anything else goes to the local model (`POST /api/agent/interpret`), which only
  classifies the request. Names are checked against the real data, nothing is invented, and nothing is
  applied without approval.
- **Learning** (`learning.ts`): every version you choose over others, and every class you drag, nudges a small set
  of preference weights (finish early, fewer teacher days, avoid first or last period, even days, few gaps). Those
  become solver weights for a *Your style* timetable. Small and explainable, and it never leaves the institution.

## Workspace layout
- `apps/mobile`: the app (Expo SDK 57, expo-router) for Android, iOS and web
- `apps/web`: the earlier React web app
- `apps/api`: Node.js API for accounts, institutions, timetable versions, parsing and the assistant
- `services/solver`: Python scheduling engine using OR-Tools CP-SAT, with styles and learned weights
- `packages/core`: shared scheduling, operations and intelligence logic (no React, no DOM)
- `packages/shared`: older shared types
- `docs`: product, stack, design and roadmap docs
- `scripts`: setup, dev runner, test runners, the app's static server and the end-to-end test

## The coordinator's flow (earlier web app)
TimeFlex is presented as a timetable maker. Every step asks only for what a timetable needs, plus optional details that
each pay off inside the timetable, and the result is a complete record of the department.

1. **Landing page**: a 3D campus hero (three.js, loaded only on this page), features, how it works, and a
   light/dark switch that remembers your choice.
2. **Institution account**: sign up with the institution name and type plus your name, e-mail and password. One
   account owns one institution. Then pick how to start: add teachers one by one, describe the department to the AI,
   or explore with sample data.
3. **Teacher profiles**: each teacher is added once and gets a profile (designation, qualification, experience,
   expertise tags, bio, contact, limits, availability, and their own week). Expertise drives suggestions: in Subjects,
   teachers whose expertise matches are starred and listed first.
4. **Build your timetable**, a six-step wizard with progress shown in the sidebar and *Next* buttons:
   - **Describe it (AI)**, optional: plain text to a reviewed draft of every step (local model, nothing leaves the machine).
   - **Basics**: working days, hours, period length, break, with a live preview of the day. Optional academic year,
     address and contacts are printed on exports.
   - **Teachers**: add one by one; each opens their profile. Load against capacity is shown per teacher.
   - **Classes**: department, year, semester, divisions, lab batches and class teacher. Paste a **class list**
     (straight from Excel) and lab batches are split from roll numbers, so batch sizes are exact.
   - **Teachers**: limits, labs, availability grid, load against capacity, optional e-mail.
   - **Rooms & labs**: type, seats, building/floor, equipment, closed times.
   - **Subjects**: code, teacher, per-class teacher, classes, frequency, block length, room or auto, heavy flag.
   - **Timetable**: generate, drag to move, double-click to lock, regenerate, versions, approve, export
     (Excel/PDF/print), copy a class or teacher week as text.
5. **Run your week** unlocks once a timetable exists. It uses the approved version, or else the newest one:
   - **Today**: the day period by period, *now* highlighted, substitutions applied.
   - **Substitutions**: mark teachers absent; each of their periods gets a ranked list of free teachers
     (present, available, not teaching then, under their daily limit; teachers of the subject and of the class
     first). Copy a notice, or WhatsApp/e-mail the substitutes.
   - **Free rooms**: which rooms are empty in any period, plus how busy each room is across the week.
   - **Attendance**: every period is a register; tap the absentees. Reports per student and subject, with a
     defaulter list below a threshold (75% by default).
6. **Directory**: **People** shows every teacher (designation, ID, contacts, load, subjects; send them their
   timetable) and every student, by class.
7. **Overview**: today at a glance, counts, and *Profile strength*, the optional details still missing and what
   each one unlocks.

Everything **autosaves** (status in the top bar). Day-to-day records (absences, substitutions, attendance) live in the
same institution profile, so nothing is entered twice.

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

## Tests
```bash
npm test             # API, core logic, web exports (node:test) and solver (pytest)
npm run typecheck    # every package, including the app

# End-to-end, in headless Chrome against the real app and API:
npm run dev                                    # API and solver
npm run app:build-web && npm run app:serve     # the app on :8081
npm run test:e2e                               # signs up, builds, compares, uses the assistant, deletes the account
```
