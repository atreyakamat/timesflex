# TimeFlex

TimeFlex is an enterprise education scheduling platform for AI-assisted and manual timetable generation.
This MVP covers the PRD's first slice: **one college department timetable**, set up by a timetable
coordinator in plain words (parsed by a small local model) or by hand, then solved with OR-Tools.

## Quick start

Needs Node 20+ and Python 3.11+. Ollama is optional.

```bash
npm install
npm run setup        # creates the solver virtualenv, checks for Ollama
ollama pull qwen3:0.6b   # optional, ~520 MB; enables AI quick setup
npm run dev          # solver :8000, API :3001, web http://localhost:5173
```

No database setup is needed: without `DATABASE_URL` the API stores data in `apps/api/data/timesflex.json`.
Set `DATABASE_URL=postgres://user:pass@localhost:5432/timesflex` to use PostgreSQL instead.

## Workspace layout
- `apps/web`: React frontend for setup, generation, and editing
- `apps/api`: Node.js API for institutions, timetable versions, chat parsing, and solver orchestration
- `services/solver`: Python scheduling engine using OR-Tools CP-SAT
- `packages/shared`: Shared types and schemas
- `docs`: Product, stack, design, and roadmap docs
- `scripts`: `setup`, `dev` and test runners (no extra dependencies)

## The coordinator's flow
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
npm test             # API parser tests, web logic + export tests (node:test), solver tests (pytest)
npm run typecheck
```
