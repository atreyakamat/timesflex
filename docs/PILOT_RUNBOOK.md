# TimeFlex pilot runbook

For the person installing and looking after TimeFlex for one department. Everything runs on one machine
inside the college; nothing is sent to the internet after the first install.

## What runs

| Service | What it does |
|---|---|
| `app` | The website and API, on port 3001 |
| `db` | PostgreSQL 16, all data (volume `timesflex_pgdata`) |
| `solver` | Builds the timetable (OR-Tools) |
| `ollama` | Local AI model `qwen3:0.6b` for Quick setup (volume `timesflex_ollama`) |
| `backup` | Dumps the database every night into `backups/` |

## Machine

- Windows 10/11, macOS or Linux with Docker Desktop (or Docker Engine + Compose v2).
- 4 CPU cores, 8 GB RAM, 10 GB free disk. No GPU needed.
- Internet only for the first install (images and the ~500 MB model).

## Install

1. Get the code: download the repository ZIP, or `git clone` it, and open a terminal in the folder.
2. Create the settings file and set a database password:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and change `POSTGRES_PASSWORD`. Keep this file private and out of email or chat.
3. Start everything:
   ```bash
   docker compose up -d --build
   ```
   The first start downloads images and the model. `docker compose ps` should show `app`, `db` and
   `solver` as healthy; `ollama-pull` exits once the model is downloaded.
4. Open http://localhost:3001 and create the **owner** account. The owner is the admin.
5. Optional: add the demo department to show people around:
   ```bash
   docker compose exec app node apps/api/src/cli/seed.js
   ```

Other computers on the college network use `http://<this-machine's-IP>:3001`. Allow port 3001 through the
machine's firewall if they cannot connect.

## Accounts

- The owner (admin) sets up the institution, teachers, rooms and subjects, generates and approves timetables.
- Staff get **viewer** accounts from **Users** on the dashboard: they can browse and export, not change.
- Recent sign-ins, saves, generations and approvals show under **Users → Recent activity**.
- Forgotten admin password:
  ```bash
  docker compose exec app node apps/api/src/cli/admin.js owner
  ```
  It asks for a new password and signs that user out everywhere.

## Backups

- A backup is taken every night at `BACKUP_TIME` (default 02:00, `TZ` Asia/Kolkata) into the `backups/`
  folder next to `docker-compose.yml`. The newest `BACKUP_KEEP` (default 14) are kept.
- The machine must be on at that time. Take one by hand before any change:
  ```bash
  docker compose exec backup sh /backup-loop.sh now
  ```
- Copy the `backups/` folder to a USB drive or another machine once a week. A backup on the same disk does
  not survive that disk failing.

### Restore

This replaces all current data with the backup.

```bash
docker compose stop app
docker compose exec -T db pg_restore -U timesflex -d timesflex --clean --if-exists --no-owner < backups/timesflex-YYYYMMDD-HHMMSS.dump
docker compose start app
```

Sign in and check the latest timetable is there.

## Day to day

| Task | Command |
|---|---|
| Stop | `docker compose stop` |
| Start | `docker compose start` |
| Status | `docker compose ps` |
| Logs | `docker compose logs -f app` |
| Update to a new version | back up, `git pull` (or unzip the new copy over it), `docker compose up -d --build` |

Database changes are applied automatically when the app starts.

## Troubleshooting

| Symptom | Check |
|---|---|
| Page does not load | `docker compose ps`; `docker compose logs app`. Port 3001 taken: set `TIMESFLEX_PORT` in `.env`. |
| "Set POSTGRES_PASSWORD in .env" | The `.env` file is missing or has no password. |
| Quick setup says the AI model is not available | `docker compose logs ollama-pull`. Rerun with `docker compose up -d ollama-pull`. Until then, Quick setup uses the basic rule parser and every other screen works. |
| Generate takes long or times out | Large departments can take up to two minutes. Raise `SOLVER_TIMEOUT_MS` in `.env`. |
| "Placed N of M" | The report under the timetable names each unplaced session and the reason, usually a teacher limit, unavailable day, or too few labs. Change the setup and regenerate, or place them by hand. |
| Changed the database password after install | The password is fixed when the database is first created. Put the old one back in `.env`, or restore a backup into a fresh install. |
| Someone is locked out after failed sign-ins | Sign-in pauses after 10 failures for 15 minutes. Wait, or reset the password as above. |

## Without Docker

`npm install && npm run setup && npm run build`, set `DATABASE_URL` in `.env`, then start the solver
(`.venv/bin/uvicorn app.main:app --port 8000` inside `services/solver`; `.venv\Scripts\uvicorn` on Windows)
and the app (`npm start -w @timesflex/api`). Backups: `node scripts/backup.mjs`, scheduled
with Task Scheduler (Windows) or cron. Restore: `node scripts/backup.mjs --restore <file>`.
