# Running TimeFlex on Docker

## Start it

On a machine with Docker, from this folder:

```bash
./deploy.sh
```

It creates `.env` with a random database password the first time, builds everything, waits until it's healthy
and prints the address. The first start takes 10 minutes or more; after that it takes seconds. Your data is
kept when containers restart or are rebuilt. Run it again after updating the code.

| Command | What it does |
|---|---|
| `docker compose logs -f` | Watch what is happening |
| `docker compose down` | Stop everything (data is kept) |
| `docker compose ps` | Check that everything is healthy |

## What runs

| Container | Job |
|---|---|
| `web` | The app, and the only way in from outside (port 8080) |
| `api` | Accounts, data and the assistant |
| `solver` | Builds the timetables |
| `db` | PostgreSQL, where everything is saved |
| `ollama` | Runs the small local AI model |
| `ollama-pull` | Downloads `qwen2.5:0.5b` once (about 400 MB), then exits. It shows as "Exited (0)", which is correct |

## How the assistant decides

1. The built-in rules try first. They are instant and handle the common phrasings.
2. Only if they don't understand, Qwen tries to work out what was meant.
3. Its answer only counts if the sentence backs it up. Who, when and how many always come from what was typed,
   never from the model, and anything unsupported gets "I did not catch that".
4. Whatever is left is shown to you. Nothing changes until you tap **Apply**.

Measured on sentences the rules weren't written for, on the real server: 17 of 24 right, 6 politely declined and
1 wrong proposal (since fixed). `qwen2.5:0.5b` on its own got 2 of 10 right, and `qwen2.5:1.5b` scored the same as
0.5b at about twice the delay, so the rules do almost all of the work. `AI_PROVIDER=off` loses very little.

If Qwen is still downloading, slow or down, the rules keep working. For rules only, set `AI_PROVIDER=off` in
`.env` and run `./deploy.sh` again.

## Settings

They live in `.env`, explained in `.env.example`. To keep the app private to your Tailscale network, set
`WEB_BIND` to the machine's Tailscale address (`tailscale ip -4`).

## Telling teachers on WhatsApp

**Works with no setup:** the Updates screen opens WhatsApp with each teacher's message ready, and you tap send.
For a group, it opens WhatsApp with a summary, and you pick the group.

**To send automatically** through WhatsApp's official API, you need a Meta developer app with the WhatsApp product:

1. Note the **phone number ID** and create a permanent **system user token** with the
   `whatsapp_business_messaging` permission.
2. Submit a Utility message template named `timetable_update` for approval, with this body:
   `Hello {{1}}, there is an update from {{2}}: {{3}}`
3. Add `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` to `.env` and run `./deploy.sh` again.
4. For delivered and read ticks, point the app's webhook at `https://your.domain/api/webhooks/whatsapp`, and add
   `WHATSAPP_APP_SECRET` and a `WHATSAPP_VERIFY_TOKEN` you make up. This needs a public HTTPS address, so it can't
   work while the server is only on Tailscale.

Teachers must have agreed to receive these messages: Meta requires it. Meta also charges per message.

**Groups:** WhatsApp's API can't post into groups people already have. Its Groups API only works with groups it
creates, capped at 8 people, and needs an Official Business Account. That's why group posts are a one-tap share.

## Someone forgot their password

There's no e-mail reset yet. Run this on the server and pass on the temporary password it prints:

```bash
docker compose exec api node src/reset-password.js someone@college.edu
```

They can change it under **More → Account**.

## Check the security

Attack your own server, and only your own. It uses throwaway accounts, removes them, and briefly rate limits the
address it runs from:

```bash
TARGET=http://localhost:8080 npm run test:security
```

## The Android app

```bash
npm run docker:apk -- http://YOUR-SERVER-ADDRESS:8080
```

- **Which address:** on Windows, run `ipconfig` and use the IPv4 address. `localhost` won't work, because on a
  phone it means the phone itself.
- **The result:** `dist-apk/TimeFlex.apk`. Send it to a phone and allow "install unknown apps".
- **The first build** takes 20 minutes or more and over 10 GB of disk.
- **If the address changes:** on the app's welcome screen, tap **Change** next to the server address. There's no
  need to rebuild.
- **If the phone can't connect:** check it's on the same Wi-Fi and that Windows Firewall allows port 8080. Some
  college networks stop devices reaching each other; a phone hotspot gets around that.

This APK is for pilots and direct installs. It's signed with the shared debug key, so the Play Store needs your
own key first. An iPhone app can't be built in Docker: Apple requires a Mac or Expo's cloud build.

## Hosting it

On any Linux server with Docker and at least 4 GB of memory:

1. Copy the project over and run `./deploy.sh` once.
2. Add `DOMAIN=your.domain`, `TRUST_PROXY=2` and `WEB_BIND=127.0.0.1` to `.env`.
3. Point the domain at the server, and open ports 80 and 443.
4. Run `docker compose --profile https up -d --build`. HTTPS certificates are automatic.
5. Build the app against it: `npm run docker:apk -- https://your.domain`.

Use HTTPS for real data: without it, passwords travel unencrypted.

**Backups** run automatically once a day and are kept for 14 days. They stay on this machine, so copy them
somewhere else as well:

```bash
docker compose cp backup:/backups ./timeflex-backups
```

To restore one onto an empty database, replacing the date with the one you want:

```bash
docker compose exec -T backup sh -c 'gunzip -c /backups/timeflex-2026-11-09.sql.gz' | docker compose exec -T db psql -U timeflex -d timeflex
```

## Limits worth knowing

- Sign-up and failed-login limits are per address, and they're generous on purpose (100 sign-ups an hour, 200 failed
  logins per 15 minutes), because a whole college can share one address. On some Docker hosts everyone appears as
  one address. Guessing a single account's password stays limited to 10 tries per 15 minutes.
- Limits are kept in memory, so they reset when the API restarts.
- Large departments work: 40 classes (800 sessions) took about 44 seconds per version on 16 cores. Allow more time
  on smaller servers.

## Before real colleges use a public server

- There is no e-mail password reset yet; use the command above.
- The **Your data** page describes what's stored. It's a plain-language draft, so have it checked against India's data protection law (DPDP Act), and add terms of use.
- Demo accounts are removed after a day. To turn the demo off, set `ALLOW_DEMO=false`.
