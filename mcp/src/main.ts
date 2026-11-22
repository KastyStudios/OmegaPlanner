/*
 * OmegaPlanner MCP server (stdio). Lets any MCP client (e.g. Claude Code sessions) read your day
 * and create or change plans. Changes go into the app's Dropbox sync file and show up in the app
 * on its next sync.
 *
 *   node dist/omegaplanner-mcp.mjs login   connect to Dropbox once
 *   node dist/omegaplanner-mcp.mjs         run the server (MCP clients start it this way)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { format } from 'date-fns';
import { z } from 'zod';
import { login } from './dropbox';
import * as planner from './planner';
import { read, write } from './store';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const server = new McpServer(
  { name: 'omegaplanner', version: '0.1.0' },
  {
    instructions: [
      "OmegaPlanner is the user's personal planner (events, tasks, deadlines, to-dos, goals).",
      `All dates and times are local time in ${TZ}: write them as YYYY-MM-DD or YYYY-MM-DDTHH:mm, without a zone.`,
      'A meeting or appointment is an item of kind "event". A task without a start is an unscheduled to-do.',
      'Recurring items: to change, delete or check off one occurrence, pass the item id and the occurrence value shown by get_agenda.',
      'Changes reach the app on its next sync (when it opens, regains focus, or within a minute while open).',
    ].join('\n'),
  },
);

type Text = { content: { type: 'text'; text: string }[]; isError?: boolean };
const run =
  <A>(fn: (args: A) => Promise<string>) =>
  async (args: A): Promise<Text> => {
    try {
      return { content: [{ type: 'text', text: await fn(args) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
    }
  };

const nowLine = () => `Now: ${format(new Date(), "EEEE d MMMM yyyy, HH:mm")} (${TZ})\n\n`;
const readOnly = { readOnlyHint: true, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const date = z.string().describe('Local date YYYY-MM-DD');
const dateTime = z.string().describe('Local YYYY-MM-DDTHH:mm, or YYYY-MM-DD for an all-day item');
const occurrence = z.string().describe('For a recurring item: the occurrence value from get_agenda (identifies one occurrence)');
const scope = z.enum(['this', 'following', 'all']).describe('For a recurring item: this occurrence, this and following, or the whole series');
const itemFields = {
  kind: z.enum(['event', 'task', 'deadline']).optional().describe('event = meeting/appointment/time block; task = to-do (no start = unscheduled); deadline = due by a date/time'),
  start: dateTime.optional(),
  end: dateTime.optional().describe('Local end time; for all-day items the last day (inclusive). Default: start + duration_minutes'),
  duration_minutes: z.number().int().positive().optional().describe('Length when no end is given (default 60)'),
  all_day: z.boolean().optional(),
  category: z.string().optional().describe('Category name, see list_categories'),
  goal: z.string().optional().describe('Goal title to link to, see list_goals'),
  notes: z.string().optional(),
  repeat: z.string().optional().describe('RFC 5545 rule body, e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR or FREQ=DAILY;COUNT=10. Empty string removes repetition'),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  reminders_minutes: z.array(z.number().int().min(0)).optional().describe('Notify this many minutes before the start'),
};

server.registerTool(
  'get_agenda',
  {
    title: 'Get agenda',
    description: "The user's plans for a day or several days: events, tasks and deadlines with times, plus overdue items and upcoming deadlines when the range starts today.",
    inputSchema: { date: date.optional().describe('First day (default today)'), days: z.number().int().min(1).max(31).optional().describe('Number of days (default 1)') },
    annotations: readOnly,
  },
  run(async ({ date: d, days }) => nowLine() + planner.agenda(await read(), d ? planner.parseLocal(d).date : new Date(), days ?? 1)),
);

server.registerTool(
  'list_todos',
  {
    title: 'List to-dos',
    description: 'Unscheduled to-dos (tasks without a date), highest priority first.',
    inputSchema: { include_done: z.boolean().optional() },
    annotations: readOnly,
  },
  run(async ({ include_done }) => planner.todos(await read(), !!include_done)),
);

server.registerTool(
  'search',
  {
    title: 'Search items',
    description: 'Find items by words in their title or notes.',
    inputSchema: { query: z.string().min(1) },
    annotations: readOnly,
  },
  run(async ({ query }) => planner.search(await read(), query)),
);

server.registerTool(
  'find_free_time',
  {
    title: 'Find free time',
    description: 'Free slots on a day between timed plans, e.g. to pick a meeting time.',
    inputSchema: {
      date,
      duration_minutes: z.number().int().positive().describe('Minimum length of a slot'),
      from: z.string().optional().describe('Earliest time HH:mm (default 08:00)'),
      to: z.string().optional().describe('Latest time HH:mm (default 20:00)'),
    },
    annotations: readOnly,
  },
  run(async ({ date: d, duration_minutes, from, to }) => planner.freeTime(await read(), planner.parseLocal(d).date, duration_minutes, from, to)),
);

server.registerTool(
  'list_categories',
  { title: 'List categories', description: 'Categories items can be filed under.', inputSchema: {}, annotations: readOnly },
  run(async () => planner.categories(await read())),
);

server.registerTool(
  'list_goals',
  { title: 'List goals', description: 'Goals with their current progress, streaks and linked items.', inputSchema: {}, annotations: readOnly },
  run(async () => planner.goals(await read())),
);

server.registerTool(
  'create_item',
  {
    title: 'Create item',
    description: 'Add a meeting/event, task, deadline or unscheduled to-do to the planner.',
    inputSchema: { title: z.string().min(1), ...itemFields },
    annotations: writes,
  },
  run(async (args) => write((data, tx) => planner.createItem(data, tx, args))),
);

server.registerTool(
  'update_item',
  {
    title: 'Update item',
    description:
      'Change an item: move or resize it, rename it, change category, notes, priority or repetition. Only the fields given change. For one occurrence of a recurring item pass occurrence_start and scope.',
    inputSchema: { id: z.string(), occurrence_start: occurrence.optional(), scope: scope.optional(), title: z.string().optional(), ...itemFields },
    annotations: writes,
  },
  run(async ({ id, ...args }) => write((data, tx) => planner.updateItem(data, tx, id, args))),
);

server.registerTool(
  'delete_item',
  {
    title: 'Delete item',
    description: 'Delete an item. For a recurring item pass occurrence_start and scope to delete only some occurrences; without them the whole series is deleted.',
    inputSchema: { id: z.string(), occurrence_start: occurrence.optional(), scope: scope.optional() },
    annotations: { ...writes, destructiveHint: true },
  },
  run(async ({ id, occurrence_start, scope: s }) => write((data, tx) => planner.deleteItem(data, tx, id, occurrence_start, s))),
);

server.registerTool(
  'set_done',
  {
    title: 'Check off',
    description: 'Mark an item (or one occurrence of a recurring item) done or not done.',
    inputSchema: { id: z.string(), done: z.boolean().optional().describe('Default true'), occurrence_start: occurrence.optional() },
    annotations: writes,
  },
  run(async ({ id, done, occurrence_start }) => write((data, tx) => planner.setDone(data, tx, id, done ?? true, occurrence_start))),
);

if (process.argv[2] === 'login') {
  login().then(
    () => process.exit(0),
    (e) => {
      console.error((e as Error).message);
      process.exit(1);
    },
  );
} else {
  await server.connect(new StdioServerTransport());
}
