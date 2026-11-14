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
| `src/services/icsImport.ts` | `.ics` parsing (ical.js) and re-import planning |
| `src/services/` | Reminder polling, backup export and import |
