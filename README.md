# OmegaPlanner

A local life-planning web app: events, to-dos, deadlines, goals and recurring items, with a
month / week / day / agenda calendar. All data stays in your browser (IndexedDB).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run test     # domain unit tests (recurrence, series edits, goals, reminders)
npm run build    # type-check + production build into dist/
```

## Features

- **Item types**: events (set time), tasks (scheduled or unscheduled to-dos), deadlines (⚑).
- **Recurrence**: daily / weekly on chosen days / monthly / yearly, every N, ending never / on a date / after N times.
  Edit or delete *this occurrence*, *this and following*, or *all*, and check each occurrence off separately.
  Wall-clock times are kept across DST changes.
- **Calendar**: month, week, day and agenda views. Drag to move, resize to change duration, select a slot to
  create, and drag unscheduled to-dos from the side panel onto the calendar. Filter by category.
- **Goals**: *habit* goals (N times per week or month, with a streak) count checked-off occurrences of linked items.
  *Milestone* goals show the share of linked tasks that are done.
- **Import from Google Calendar** (Settings → Import): pick the `.ics` files from a Google export
  (Google Calendar → ⚙ Settings → Import & export → Export, then unzip). By default only events from the last week onward are imported (series that started earlier begin at that point). Repeat rules, deleted and edited
  occurrences, time zones, locations and reminders are imported. Importing again updates events instead
  of duplicating them, keeps your category / goal / done marks, and can optionally remove events deleted in Google.
- **Categories** with colours, **reminders** via browser notifications, **dark mode**, JSON **backup / restore**.
- Keyboard: `N` opens a new item.

Reminders fire only while the app is open in a browser tab, because there is no server to push notifications.

## Ask an AI assistant about your day (MCP)

The `mcp/` folder holds an MCP server, so assistants such as Claude Code can read your agenda, find
free time and create or change plans. See [mcp/README.md](mcp/README.md).

## Use it on your phone (Cloudflare Pages + Dropbox sync)

OmegaPlanner is a static web app that installs on your phone's home screen and works offline. Devices
sync through a file in **your own Dropbox**. There is no OmegaPlanner account or server.

The live app is at **https://omegaplanner.pages.dev**. The old GitHub Pages address only redirects there.

### 1. Publish the app (once)

1. Push this project to a GitHub repository.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick the repository and set
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variables: `NODE_VERSION` = `22`, and optionally `VITE_DROPBOX_APP_KEY` (see below)
3. Cloudflare builds and publishes every push to `main` at `https://<project>.pages.dev`. The build also
   writes `dist/_headers`, so the security headers (CSP and others) are sent as real HTTP headers.
   The *Test* workflow on GitHub runs the tests and a build on every push.

### 2. Create a Dropbox app (once, about 5 minutes)

1. Go to <https://www.dropbox.com/developers/apps/create>, choose **Scoped access** → **App folder**,
   and give it a unique name (e.g. `OmegaPlanner-yourname`).
2. **Permissions** tab: tick `files.content.write` and `files.content.read`, then **Submit**.
3. **Settings** tab → **Redirect URIs**: add every address you open OmegaPlanner from, e.g.
   `https://<project>.pages.dev/` and `http://localhost:5173/`.
   Keep **Allow public clients (Implicit Grant & PKCE)** on **Allow**.
4. Copy the **App key**. Either paste it in OmegaPlanner under **Settings → Sync** on each device, or add it
   once as the Cloudflare Pages environment variable `VITE_DROPBOX_APP_KEY` and redeploy, so every
   device has it built in. The app key is not a secret.

### 3. Connect your devices

- **Phone:** open the app's address, then install it (Android Chrome: menu → *Install app*;
  iPhone Safari: Share → *Add to Home Screen*). Open **Settings → Sync → Connect Dropbox**.
- **Computer:** do the same, on the address you want to keep using.
  Note: browser storage is per address, so data you entered at `http://localhost:5173` is only there.
  Connect that address to Dropbox once and its data merges into the sync file, after which every
  connected device has it.

Sync runs when the app opens, when you switch back to it, a few seconds after every change, and every
minute while open. Per record the most recent change wins (deletions included), so editing on both
devices is safe. The sync file is `Apps/<your app name>/omegaplanner-sync.json` in your Dropbox.
Theme, default item color and reminder state stay per device.

Reminders only fire while the app is open. Phones pause web apps in the background, so treat
reminders as a desktop feature.

## Code map

| Path | Purpose |
| --- | --- |
| `src/db/` | Dexie schema (`schema.ts`, `db.ts`) and repository functions (`repo.ts`) |
| `src/domain/recurrence.ts` | rrule expansion into occurrences, rule builder and parser |
| `src/domain/seriesEdit.ts` | Pure this / following / all edit and delete logic, returning change sets |
| `src/domain/goals.ts` | Habit and milestone progress |
| `src/domain/reminders.ts` | Which reminders are due |
| `src/components/` | Item editor, recurrence editor, scope dialog, shared UI |
| `src/pages/` | Today, Calendar, To-dos, Goals, Settings |
| `src/sync/` | Dropbox client (PKCE), merge engine, sync service |
| `src/services/icsImport.ts` | `.ics` parsing (ical.js) and re-import planning |
| `src/services/` | Reminder polling, backup export and import |
