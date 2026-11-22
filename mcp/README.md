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

## Remote server and push reminders (Cloudflare Worker)

`src/worker/` runs the same tools as a remote MCP server on Cloudflare Workers, for clients that
can't start a local process, such as claude.ai (also in the phone app). The same Worker pushes due
reminders to phones and browsers every minute, so they arrive even when OmegaPlanner is closed.

- **MCP:** `https://<worker>/mcp`. Clients sign in with OAuth: a consent page, then Dropbox sign-in.
  Only Dropbox accounts in the `ALLOWED_DROPBOX_ACCOUNTS` secret are accepted.
- **Push:** the app's *Settings → Reminders → Turn on reminders* subscribes the device. The Worker
  keeps the account's Dropbox refresh token (in KV) to read the planner, and sends Web Push
  (RFC 8291 encryption, VAPID) for reminders due in each minute.
- **Time zone:** the Worker computes in `TIME_ZONE` (wrangler.jsonc) through `src/lib/zone.ts`.

Deploy (once `npx wrangler login` is done):

```bash
npx wrangler kv namespace create OAUTH_KV      # put both ids in wrangler.jsonc
npx wrangler kv namespace create PLANNER_KV
npx wrangler secret put VAPID_PRIVATE_JWK      # private key JWK; public key goes in wrangler.jsonc
npx wrangler secret put ALLOWED_DROPBOX_ACCOUNTS
npm run deploy
```

Add `https://<worker>/callback` as a redirect URI of the Dropbox app, and set the app's push server
(`VITE_PUSH_SERVER`, default in `vite.config.ts`) to the Worker's address.

In claude.ai: **Settings → Connectors → Add custom connector**, URL `https://<worker>/mcp`.

## Tests

The planner, time zone, push encryption (RFC 8291 test vector), reminder timing and HTTP transport
tests run with the app's tests (`npm test` in the project root; run `npm install` in `mcp/` first).
