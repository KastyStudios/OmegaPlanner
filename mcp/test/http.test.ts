import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { describe, expect, it } from 'vitest';
import type { DropboxFiles } from '../src/dropboxApi';
import { makeStore } from '../src/store';
import { createPlannerServer } from '../src/tools';

/** In-memory stand-in for the Dropbox sync file. */
function memoryFiles() {
  let file: { text: string; rev: string } | null = null;
  let n = 0;
  return {
    async download() {
      return file;
    },
    async upload(_path: string, text: string) {
      file = { text, rev: String(++n) };
      return file.rev;
    },
  } as unknown as DropboxFiles;
}

/** One stateless request, the way the Worker handles /mcp. */
async function call(files: DropboxFiles, body: unknown) {
  const server = createPlannerServer(makeStore(files), { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(
    new Request('https://worker.test/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify(body),
    }),
  );
  return (await res.json()) as { result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean }; error?: unknown };
}

describe('MCP over HTTP (Worker transport)', () => {
  it('initializes, lists tools, creates and reads an item', async () => {
    const files = memoryFiles();
    const init = await call(files, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    });
    expect(init.error).toBeUndefined();
    const list = await call(files, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(list.result?.tools?.map((t) => t.name)).toContain('create_item');
    const created = await call(files, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'create_item', arguments: { title: 'Dentist', start: '2026-11-24T10:00', duration_minutes: 30 } },
    });
    expect(created.result?.isError).toBeFalsy();
    const agenda = await call(files, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_agenda', arguments: { date: '2026-11-24' } } });
    expect(agenda.result?.content?.[0].text).toContain('10:00 – 10:30 Dentist');
    const bad = await call(files, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'create_item', arguments: { title: 'x', category: 'Nope' } } });
    expect(bad.result?.isError).toBe(true);
  });
});
