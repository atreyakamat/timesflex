# Biometric bridge

Connects fingerprint and face machines to TimeFlex. It runs on the college's network, the machine reports to it, and it forwards each punch.

```
fingerprint machine  →  this bridge  →  TimeFlex
 keeps the fingerprints   keeps a queue    gets only "A01 at 09:25"
```

**TimeFlex never receives or stores a fingerprint.** The machine compares fingers itself and reports only the person's ID.

## Status: not yet tried on real hardware

The machine protocol (ZKTeco "ADMS" push, also used by some compatible brands) comes from public third-party write-ups, not the vendor. It's tested against a simulator that does what those write-ups describe. **Before buying machines for a whole college, test one.** Things that may differ by firmware: timestamp format, the exact greeting a machine expects, and whether it needs its push setting enabled.

If a machine doesn't work, the file import below and the direct API still do.

## Set up

1. In TimeFlex, go to **More > Devices** and add a device of type **Gate** or **Classroom**. Copy the key; it shows once.
2. On a computer at the college that stays on:

   ```sh
   TIMEFLEX_URL=http://your-server:8080 TIMEFLEX_DEVICE_KEY=tfd_... node main.mjs
   ```

   Or with Docker, from the repository root, after putting those two values in `.env`:

   ```sh
   docker compose --profile bridge up -d bridge
   ```

3. On the machine, set the server address to that computer and port 8081, and turn on ADMS/push.
4. **Enrol each student on the machine using their roll number as their ID.** That's how a punch finds the student.

### Roll numbers must be unique across the college

If two classes both have a roll number `1`, TimeFlex can't tell who punched, so it refuses to guess and lists the ID as unmatched under **More > Devices**. Use full roll numbers such as `SYA01`. Some machines only accept numeric IDs, in which case the roll numbers need to be numeric and unique too. QR cards don't have this problem.

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `TIMEFLEX_URL` | required | Your TimeFlex address |
| `TIMEFLEX_DEVICE_KEY` | required | The key from More > Devices |
| `COLLEGE_UTC_OFFSET` | `+05:30` | Machines report local time with no zone |
| `ALLOWED_SERIALS` | anyone | Machine serial numbers allowed to report. **Set this:** the protocol has no password, so anyone on the network could otherwise send fake punches |
| `PORT` | `8081` | Where machines connect |
| `QUEUE_FILE` | `timeflex-queue.json` | Punches waiting to be sent |
| `FLUSH_SECONDS` | `15` | How often to retry |

## When things go wrong

- **Server down or no internet:** punches wait in the queue file, survive restarts, and go when it's back. Resending never double-counts.
- **Wrong key:** the log says so, and punches are kept.
- **Machine clock wrong:** TimeFlex refuses punches in the future or over 14 days old. They're set aside in `<queue file>.rejected`, so they can't block the rest.
- **Unknown ID:** the punch is dropped, and the ID is listed under More > Devices.

## Try it with no hardware

```sh
node main.mjs &
node simulate.mjs http://localhost:8081 A01 A02
```

## Readers that only export a file

```sh
node main.mjs import punches.csv
```

One punch per line: `A01,2026-11-09 08:50`.

## Your own device

An ESP32 with a QR or RFID reader needs no bridge. See [docs/INTEGRATIONS.md](../../docs/INTEGRATIONS.md).
