# OmegaPlanner MCP server

Lets AI assistants (any MCP client, e.g. Claude Code sessions) read your day and create or change
plans in OmegaPlanner. It works on the same Dropbox sync file as the app and uses the app's own
recurrence, series-edit and merge logic, so changes show up in the app (and on your phone) on its
next sync.

## Tools

| Tool | What it does |
| --- | --- |
| `get_agenda` | Plans for a day or several days, plus overdue items and upcoming deadlines |
| `list_todos` | Unscheduled to-dos, highest priority first |
| `search` | Find items by title or notes |
| `find_free_time` | Free slots on a day, e.g. to pick a meeting time |
| `list_categories`, `list_goals` | Categories; goals with progress and streaks |
| `create_item` | Add an event/meeting, task, deadline or to-do (optionally repeating) |
| `update_item` | Move, rename or change an item; one occurrence, following, or the whole series |
| `delete_item` | Delete an item or some occurrences of a series |
| `set_done` | Check off an item or one occurrence |

Times are local (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`) in the computer's time zone.

## Setup

```bash
cd mcp
npm install
npm run build
node dist/omegaplanner-mcp.mjs login     # approve Dropbox access once (uses port 5173; stop the dev server first)
claude mcp add omegaplanner --scope user -- node "<full path>/mcp/dist/omegaplanner-mcp.mjs"
```

The login stores a Dropbox refresh token in `~/.omegaplanner/dropbox.json`; keep that file private.
Access is limited to the app's own Dropbox folder. To disconnect, delete the file and remove the app
under Dropbox → Settings → Connected apps.

Tests for the planner logic run with the app's tests (`npm test` in the project root).
