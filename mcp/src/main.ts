/*
 * OmegaPlanner MCP server, local stdio version. Lets MCP clients on this computer (e.g. Claude Code
 * sessions) read your day and create or change plans. Changes go into the app's Dropbox sync file
 * and show up in the app on its next sync.
 *
 *   node dist/omegaplanner-mcp.mjs login   connect to Dropbox once
 *   node dist/omegaplanner-mcp.mjs         run the server (MCP clients start it this way)
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { localDropbox, login } from './dropbox';
import { makeStore } from './store';
import { createPlannerServer } from './tools';

if (process.argv[2] === 'login') {
  login().then(
    () => process.exit(0),
    (e) => {
      console.error((e as Error).message);
      process.exit(1);
    },
  );
} else {
  await createPlannerServer(makeStore(localDropbox())).connect(new StdioServerTransport());
}
