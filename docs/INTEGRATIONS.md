# Connecting other systems

TimeFlex connects to the rest of a college in three ways. All of them use a key made under **More > Devices** in the app. A key belongs to one college, is shown once, is stored only as a hash, and can be removed at any time. Send it as `Authorization: Bearer tfd_...`. Use HTTPS outside a trusted network, since the key travels with every request.

| You have | Use | Key type |
| --- | --- | --- |
| A fingerprint or face machine, any brand | [The fingerprint guide](BIOMETRIC-GUIDE.md) | Gate or Classroom |
| Your own reader (ESP32, Raspberry Pi, RFID) | [Send scans](#send-scans) | Gate or Classroom |
| An ERP or other software | [Read data](#read-data) | Other software |

A **Gate** device marks a student late when their first scan of the day comes after their first class has started, plus a grace period (10 minutes unless changed). A **Classroom** device only records that they were there.

## Send scans

```
POST /api/device/v1/scans
```

```json
{ "scans": [{ "identifier": "SYA01", "at": "2026-11-09T03:55:00Z", "scanId": "reader1-000123" }] }
```

- `identifier` (required): a student's roll number, or the contents of their QR card.
- `at` (optional): when it happened, as ISO 8601 with a time zone. Defaults to now. Up to 14 days old is accepted, so a device can catch up after an outage.
- `scanId` (optional, recommended): your own id for this scan. Resending the same one is safe.
- Up to 500 scans per request.

```json
{ "accepted": 1, "duplicates": 0, "unmatched": [] }
```

`unmatched` lists identifiers that don't fit exactly one student. An identifier is matched as a signed QR card, then a machine ID linked under More > Fingerprint machines, then a roll number. A roll number used in two classes is treated as unmatched rather than guessed. Unmatched IDs also appear in the app, beside the device.

| Status | Meaning | What to do |
| --- | --- | --- |
| 200 | Done | |
| 400 | Something in the batch is wrong, and none of it was saved | Don't resend it unchanged. Often the device's clock is wrong |
| 401 | Key removed, or college paused | Stop and tell someone |
| 403 | This key can't write | Use a Gate or Classroom key |
| 429 | Over 600 requests a minute | Wait, then resend |
| 5xx, or no answer | Try again | Keep the scan and resend with the same `scanId` |

Example:

```sh
curl -X POST "$TIMEFLEX_URL/api/device/v1/scans" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"scans":[{"identifier":"SYA01"}]}'
```

## Read data

Keys of the type **Other software** can read and can't change anything.

| Request | Returns |
| --- | --- |
| `GET /api/integration/v1/students` | `id`, `rollNo`, `name`, `class`, `batch` |
| `GET /api/integration/v1/timetable` | The approved timetable, with names |
| `GET /api/integration/v1/attendance?date=` or `?from=&to=` | Each register, with who was absent |
| `GET /api/integration/v1/events?date=` | Late marks, flags and remarks, except voided ones |

Dates are `YYYY-MM-DD`. These contain student records, so the receiving system takes on the same duty to protect them.

## Not built yet

- **Importing students from another system.** Class lists are pasted or typed in the app for now.
- **Webhooks** (TimeFlex calling your system). Poll the read API instead.

## Fingerprints and the law

TimeFlex never receives a fingerprint: the machine keeps them and reports only an ID. The college collecting them still takes on responsibility under India's DPDP Act, and most students are adults or close to it, with minors needing a parent's consent. Tell students what's collected and why, and offer a QR card as an alternative. Take advice for your own situation; this isn't legal advice.
