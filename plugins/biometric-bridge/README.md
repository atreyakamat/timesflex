# TimeFlex fingerprint connector

Connects fingerprint, face and card machines of any brand to TimeFlex. It runs on the college's network and forwards each punch as "ID and time". **It never handles a fingerprint;** the machine keeps those.

**Start with the [setup guide](../../docs/BIOMETRIC-GUIDE.md)**, which explains which route fits a machine. This page is the reference.

```
machine ──push──┐
software ─file──┼──▶ connector (queue on disk) ──▶ TimeFlex
software ─web───┘
```

No dependencies: Node.js 18+ or Docker.

## Sources

| `type` | For | Settings |
| --- | --- | --- |
| `zkteco-adms` | Machines that push over the network (ADMS / Cloud server / PUSH). **Not yet tried on real hardware.** | `port` (8081), `serials`: allowed machine serial numbers |
| `folder` | Software that saves attendance files | `path`, `every` (seconds, 60) |
| `webhook` | Software that calls a web address | `port` (8082), `path` (`/punch`), `secret` (16+ characters), `fields`: `id`, `time`, optional `list` |

Give each source a `name`. Any number of sources can run at once, all sharing one queue.

## Running it

One push machine, with nothing but environment variables:

```bash
TIMEFLEX_URL=https://your-timeflex TIMEFLEX_DEVICE_KEY=tfd_... ALLOWED_SERIALS=ABC123 node main.mjs
```

Anything more: copy [bridge.config.example.json](bridge.config.example.json), keep the sources you need, and run:

```bash
BRIDGE_CONFIG=bridge.config.json TIMEFLEX_DEVICE_KEY=tfd_... node main.mjs
```

With Docker, from the TimeFlex folder: set `TIMEFLEX_URL`, `TIMEFLEX_DEVICE_KEY`, and either `ALLOWED_SERIALS` or `BRIDGE_CONFIG=/config/bridge.config.json` in `.env`. For a folder source, set `BRIDGE_FOLDER` to the folder; it appears inside as `/inbox`. Then:

```bash
docker compose --profile bridge up -d bridge
```

Send one file now, without leaving anything running:

```bash
node main.mjs import attlog.dat
```

## Settings

| Variable or key | Default | |
| --- | --- | --- |
| `TIMEFLEX_URL` / `timeflexUrl` | required | Your TimeFlex address |
| `TIMEFLEX_DEVICE_KEY` / `deviceKey` | required | From More > Devices. Better in the environment than the file |
| `COLLEGE_UTC_OFFSET` / `utcOffset` | `+05:30` | Machines record local time with no zone |
| `QUEUE_FILE` / `queueFile` | `timeflex-queue.json` | Punches waiting to be sent |
| `FLUSH_SECONDS` / `flushSeconds` | `15` | How often to retry |
| `BRIDGE_CONFIG` | none | Settings file, for several sources |
| `ALLOWED_SERIALS`, `PORT` | none, `8081` | The simple push setup |
| `HEALTH_PORT` | `8090` | `GET /health` on 127.0.0.1: how many punches are waiting |

## What it guarantees

- **Nothing lost:** punches are written to the queue file before anything is sent, and stay there through outages and restarts.
- **Nothing counted twice:** each punch has a fixed id, so resending is harmless.
- **One bad punch can't block the rest:** if TimeFlex refuses a batch, punches are tried one by one, and only the refused ones are set aside in `<queue>.rejected`.
- **Old and future punches:** the key accepts up to 14 days back and 10 minutes ahead. Older ones go through the app's upload instead.

## Try it with no hardware

```bash
node main.mjs &
node simulate.mjs http://localhost:8081 A01 A02
```

## Add a machine

See [Adding support for another machine](../../docs/BIOMETRIC-GUIDE.md#adding-support-for-another-machine). Tests: `node --test plugins/biometric-bridge/test/adapters.test.mjs`.

`punchfile.mjs` is a copy of `apps/api/src/punchfile.js`; a test keeps them identical. Change both.
