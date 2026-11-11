# Connecting fingerprint machines

This guide is for whoever sets up attendance machines at a college: the IT person, a vendor's engineer, or an admin. It works for any brand. You don't need to know which protocol a machine speaks; you only need to know what it can do, and step 1 finds that out.

**What TimeFlex receives:** a person's ID and the time they punched. **Never a fingerprint or face.** The machine compares fingers itself and keeps those templates. The same goes for face, card and palm machines.

## 1. Find out what your machine can do

Look through the machine's menu (usually **Comm.**, **Network**, **Cloud** or **System**) and its software. Use the first row that applies.

| If the machine or its software... | Route | Needs a computer left on? | Live? |
| --- | --- | --- | --- |
| Has **ADMS**, **Cloud server**, **PUSH** or **Server address** in its network menu | [A. Push](#a-push-the-machine-sends-each-punch) | Yes, or a small box such as a Raspberry Pi | Within seconds |
| Comes with software that **can call a web address or webhook** | [B. Webhook](#b-webhook-its-software-calls-a-web-address) | Yes | Within seconds |
| Comes with software that **saves attendance files to a folder** by itself | [C. Folder](#c-folder-its-software-saves-files) | Yes, the one running that software | Every minute |
| Can **export to a USB stick**, or its software can **export a report** | [D. Upload](#d-upload-export-a-file-now-and-then) | No | When someone uploads |

Every machine fits at least row D. Start with D on day one; move to A, B or C once it's working.

## 2. Decide what ID each student has on the machine

A punch reaches TimeFlex as "ID 1023 at 09:25". TimeFlex matches that ID, in this order:

1. **A machine ID you linked** to a student (More > Fingerprint machines > Machine IDs).
2. **A roll number**, if exactly one student in the college has it.

So either:

- **Enrol students with their roll number as their ID** (easiest), provided roll numbers are unique across the college. `SYA01` works. Plain `1` in every class doesn't: TimeFlex won't guess between them. Some machines only accept digits; then use digit-only roll numbers, or link IDs.
- **Or let the machine number people its own way and link the numbers.** In the app, paste a list of `machine ID, roll number` lines, or link them one at a time as they come in. Unmatched IDs are listed in the app as soon as they arrive.

## 3. Make a key

In TimeFlex: **More > Devices > Add a device**.

- **Gate:** the machine is where students arrive. A first punch after the student's first class has started (plus the grace period, 10 minutes by default) creates a late mark.
- **Classroom:** records who was there, without late marks.

Copy the key when it's shown; it isn't shown again. Treat it like a password: anyone holding it can send punches as that machine. Routes A to C need a key; route D doesn't.

## 4. Set up your route

### A. Push: the machine sends each punch

Many machines (ZKTeco, and machines built on the same firmware and sold under other names) can push punches to a server using a protocol called ADMS.

> **Not yet tried on real hardware.** The protocol details come from public third-party write-ups, not the manufacturer. Test with one machine before buying more. If it doesn't work, route D still does, and please share what the machine sent so the connector can be fixed.

1. On a computer at the college that stays on, install [Node.js](https://nodejs.org) 18 or newer, or Docker.
2. Copy the `plugins/biometric-bridge` folder there and start it:

   ```bash
   TIMEFLEX_URL=https://your-timeflex TIMEFLEX_DEVICE_KEY=tfd_... ALLOWED_SERIALS=ABC1234567 node main.mjs
   ```

   With Docker, from the TimeFlex folder, put those three values in `.env` and run:

   ```bash
   docker compose --profile bridge up -d bridge
   ```

3. On the machine, find the server setting. Write-ups place it under **Comm. > Cloud Server Setting** on ZKTeco machines; other menus differ. Set the server address to that computer's IP and port **8081**, with no proxy.
4. Find the machine's **serial number** (System > Device info) and put it in `ALLOWED_SERIALS`. The protocol has no password, so without this list anything on the network could send fake punches.
5. Punch once. Within a minute the connector logs `Sent 1 scan(s)`, and More > Devices shows the device as seen.

### B. Webhook: its software calls a web address

For cloud attendance services and access-control software that can post each event to a URL.

1. Make a settings file from [bridge.config.example.json](../plugins/biometric-bridge/bridge.config.example.json) and keep the `webhook` source.
2. Set `secret` to a long random string (at least 16 characters). Paste the same secret into the vendor software, as a header `X-Bridge-Secret: <secret>` or `Authorization: Bearer <secret>`.
3. Look at one sample event from the vendor's documentation, and set `fields`:
   - `id`: where the person's ID is, for example `employeeNo` or `person.code`.
   - `time`: where the time is. ISO times with a zone, Unix seconds or milliseconds, and local times like `09/11/2026 09:25 AM` all work.
   - `list` (only if events arrive in batches): where the list is, for example `data.events`.
4. Start the connector with `BRIDGE_CONFIG=bridge.config.json node main.mjs` and point the software at `http://<that computer>:8082/punch`.

### C. Folder: its software saves files

For software that writes attendance logs or reports to a folder on its own (common with machines sold with desktop attendance software).

1. In the vendor software, turn on automatic export or log download, saving as CSV or text, to a folder.
2. In the settings file, keep the `folder` source and set `path` to that folder.
3. Start the connector on that computer. Every minute it reads new files and new lines added to old ones. Each line is sent once, even if the file is re-read.

Punches over 13 days old are skipped, since the device key accepts two weeks at most; upload older ones with route D.

### D. Upload: export a file now and then

1. Export the attendance log: from the machine to a USB stick (often **USB > Download > Attendance**, giving a file like `attlog.dat`), or from its software as CSV or Excel. Save Excel files as CSV first.
2. In TimeFlex: **More > Fingerprint machines > Upload a file**. Choose the file, pick Gate or Classroom, and press **Preview**.
3. The preview shows a few punches with the student each one matched, how many IDs matched nobody, and any lines it couldn't read. Link unmatched IDs on the Machine IDs tab, then preview again.
4. Press **Import**. Uploading the same file twice adds nothing, so overlapping exports are safe.

Up to 20,000 punches and two months back per upload.

## Formats the reader understands

The same reader is used for uploads, the folder route and the command line, so a file that previews correctly works everywhere.

- **Separators:** tab, comma, semicolon or spaces, with quoted cells like `"Diya, K"`.
- **Columns:** any order. With a header row, it recognises names such as *User ID*, *Emp Code*, *Enroll No*, *AC-No*, *PIN*, *Badge*, *Card No*, *Roll No* for the person, and *Punch Time*, *Date Time*, *Check Time*, *Log Time*, or separate *Date* and *Time* columns. Without a header, it takes the first cell that isn't a date as the ID.
- **Dates:** `2026-11-09`, `2026/11/09`, `09/11/2026`, `09-11-26`, `09.11.2026`, `09-Nov-2026`, `9 November 2026`. Dates like `09/11/2026` are read day first, as in India, unless that's impossible, such as `11/25/2026`.
- **Times:** `09:25`, `09:25:03`, `9:25 AM`.
- **Time zone:** machines record local time with no zone. TimeFlex reads uploads in the college's zone (India by default). The connector uses `utcOffset` (default `+05:30`).

If a file doesn't read, the preview shows example lines it couldn't understand. Send one of those to whoever maintains TimeFlex; supporting a new format is usually a one-line change with a test.

## Checklist before going live

- [ ] One machine tested end to end: a punch shows under the student's scans.
- [ ] Every student's ID matches: no unmatched IDs left in the app after a full day.
- [ ] The machine's clock is right. A wrong clock means wrong late marks, or punches refused as "in the future".
- [ ] `ALLOWED_SERIALS` (route A) or a strong `secret` (route B) is set.
- [ ] The connector restarts by itself: Docker's `restart: unless-stopped`, or a Windows scheduled task at start-up.
- [ ] Students were told what's collected and why, and offered a QR card instead.

## When something goes wrong

| What you see | Likely cause | Fix |
| --- | --- | --- |
| Connector: `answered 401: check the device key` | The key was removed, or mistyped | Make a new key under More > Devices |
| Connector: `Can't reach TimeFlex` | No internet, or the address is wrong | Punches wait in the queue and go when it's back; nothing is lost |
| Connector: `refused and set aside` | Usually the machine's clock is wrong | Fix the clock. Set-aside punches are in `<queue file>.rejected` |
| App: IDs listed as unmatched | The machine's ID isn't a roll number, or two students share it | Link them on the Machine IDs tab |
| Machine never connects (route A) | Wrong IP or port, a firewall, or the machine doesn't support push | Check the firewall allows port 8081; try route D meanwhile |
| A student is marked late wrongly | Gate key on a classroom machine, or the timetable is wrong for that day | Use a Classroom key there; void the mark from the student's record |

## Adding support for another machine

If a machine fits none of the routes, or has its own protocol, add an adapter to the connector. The connector has no dependencies, and an adapter is one file in `plugins/biometric-bridge/adapters/`:

```js
// adapters/my-brand.mjs
export const createMyBrandSource = (options, { enqueue, log, offset, stateFile, onReceived }) => ({
  async start() {
    // Listen, poll, or read: however this machine talks.
    // For each punch:
    //   enqueue([{ identifier: '1023', at: '2026-11-09T03:55:00.000Z', scanId: 'stable-id' }]);
    //   onReceived();
  },
  async stop() {},
});
```

- `identifier`: the person's ID on the machine, as text.
- `at`: an ISO time with a zone. Machines give local time; convert it with `offset`.
- `scanId`: the same value whenever this punch is sent again (for example a hash of the machine, ID and time), so a resend never counts twice.
- Register it in [adapters/index.mjs](../plugins/biometric-bridge/adapters/index.mjs), then use `"type": "my-brand"` in the settings.

The connector already handles queueing, retries, outages, restarts, refused punches and batching. Add tests beside the others in `plugins/biometric-bridge/test/`.

Without the connector, any program can send punches straight to TimeFlex. See [INTEGRATIONS.md](INTEGRATIONS.md#send-scans).

## Fingerprints and the law

India's DPDP Act applies to the college collecting fingerprints, even though TimeFlex never receives them. Tell students what's collected, why and for how long; get consent, and a parent's for anyone under 18; offer a QR card as an alternative; and delete people from the machine when they leave. This is a summary, not legal advice.
