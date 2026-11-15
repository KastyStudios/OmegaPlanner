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

## Use it on your phone (GitHub Pages + Dropbox sync)

OmegaPlanner is a static web app that installs on your phone's home screen and works offline. Devices
sync through a file in **your own Dropbox**. There is no OmegaPlanner account or server.

### 1. Publish the app (once)

1. Create a **public** repository on GitHub, e.g. `OmegaPlanner` (only the code is public, your data never goes there).
2. Push this project:
   ```bash
   git remote add origin https://github.com/<your-user>/OmegaPlanner.git
   git push -u origin main
   ```
3. In the repository: **Settings → Pages → Source: GitHub Actions**.
4. The *Deploy to GitHub Pages* workflow builds, tests and publishes on every push to `main`.
   The app is then at `https://<your-user>.github.io/OmegaPlanner/`.

### 2. Create a Dropbox app (once, about 5 minutes)

1. Go to <https://www.dropbox.com/developers/apps/create>, choose **Scoped access** → **App folder**,
   and give it a unique name (e.g. `OmegaPlanner-yourname`).
2. **Permissions** tab: tick `files.content.write` and `files.content.read`, then **Submit**.
3. **Settings** tab → **Redirect URIs**: add every address you open OmegaPlanner from, e.g.
   `https://<your-user>.github.io/OmegaPlanner/` and `http://localhost:5173/`.
   Keep **Allow public clients (Implicit Grant & PKCE)** on **Allow**.
4. Copy the **App key**. Either paste it in OmegaPlanner under **Settings → Sync** on each device, or add it
   once as a repository variable (**Settings → Secrets and variables → Actions → Variables**, name
   `DROPBOX_APP_KEY`) and re-run the deploy so every device has it built in. The app key is not a secret.

### 3. Connect your devices

- **Phone:** open the GitHub Pages address, then install it (Android Chrome: menu → *Install app*;
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
