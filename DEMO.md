# Demo day

## Before you leave (once)

1. `npm install` and `npm run setup` (first time on a laptop only).
2. Turn on Claude: copy `apps/api/.env.example` to `apps/api/.env` and put your key after `ANTHROPIC_API_KEY=`.
   The file is ignored by git, so the key is never committed. Without a key everything still works; the
   assistant just uses its built-in rules instead of Claude.

## At the college

```bash
npm run demo
```

The browser opens on TimeFlex. The terminal says whether Claude is on. Keep the window open; Ctrl+C stops it.
After changing the app's code, run `npm run demo -- --rebuild` once.

## A five-minute pitch

1. **Landing page**: "Your department's timetable, planned with you." Click **Try the live demo**.
2. **Preparing your demo college** (about 15 seconds): a real engineering department, with 7 teachers,
   116 students, 2 classes with lab batches, 6 rooms and 8 subjects. It builds three timetables live.
3. **Home**: what the assistant noticed (e.g. *teachers wait between classes*), with a one-tap fix.
4. **Timetable**: no clashes, labs in parallel batches. Tap any class: **why is it here**, and where it could
   move without breaking anything. Scroll down to **Compare versions**. Fewer teacher days, compact days:
   pick one, and it learns your taste.
5. **Ask TimeFlex** (the sparkle button): type *"Mehta is on leave from Monday to Wednesday"*. It shows the
   change, you tap **Apply**.
6. **Cover**: go to Monday. Mehta's periods need cover; **Auto-assign** picks fair substitutes, then
   **Share on WhatsApp**.
7. Close: "Your coordinator gets back the weeks they spend on this every semester."

Good things to type to the assistant: *"Iyer can't teach on Fridays"*, *"max 3 a day for Rao"*,
*"add lab 3 with 32 seats"*, *"make 3 variations"*. With Claude on, looser phrasing works too:
*"Rao is going to a conference early next week"*.

## If something goes wrong

- **"Cannot reach the TimeFlex server"**: `npm run demo` is not running, or was stopped.
- **The assistant says it didn't catch something**: rephrase, or use one of the phrases above.
- **Claude not on**: check `apps/api/.env` has the key, then restart `npm run demo`. More → Assistant shows
  the status.
- Each "Try the live demo" makes a fresh demo account; they live only on this laptop.
