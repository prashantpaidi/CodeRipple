import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';

import { analyzeImpact } from '../impact/impact-analysis.js';
import { errorMessage } from '../storage/errors.js';

const protocolVersion = '2025-11-25';
const maxRequestBytes = 64 * 1024;
const maxReportBytes = 4 * 1024 * 1024;
const maxDepth = 10;
const maxRefLength = 1024;
const tool = {
  name: 'analyze_impact',
  description: 'Compare two Git revisions in the configured repository and return the static impact report.',
  inputSchema: {
    type: 'object',
    properties: {
      base: { type: 'string', minLength: 1, maxLength: maxRefLength },
      head: { type: 'string', minLength: 1, maxLength: maxRefLength },
      depth: { type: 'integer', minimum: 0, maximum: maxDepth, default: 3 },
    },
    required: ['base', 'head'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
};
const ref = z.string().min(1).max(maxRefLength).refine((value) => !value.includes('\0'));
const argumentsSchema = z.object({
  base: ref,
  head: ref,
  depth: z.number().int().min(0).max(maxDepth).default(3),
}).strict();
const requestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number().int().safe()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
const initializeSchema = z.object({
  protocolVersion: z.string().min(1),
  capabilities: z.record(z.string(), z.unknown()),
  clientInfo: z.object({ name: z.string(), version: z.string() }),
});
const callSchema = z.object({ name: z.string(), arguments: z.unknown() });
type RequestId = string | number | null;
const result = (id: RequestId, value: unknown) => ({ jsonrpc: '2.0', id, result: value });
const failure = (id: RequestId, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
const toolFailure = (text: string) => ({ isError: true, content: [{ type: 'text', text }] });

/** Read newline-delimited frames and discard oversized requests until the next newline. */
async function* frames(input: Readable): AsyncGenerator<string | null> {
  let parts: Buffer[] = [];
  let size = 0;
  for await (const value of input as AsyncIterable<Buffer | string>) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      size += end - offset;
      if (size <= maxRequestBytes) parts.push(chunk.subarray(offset, end));
      else parts = [];
      offset = end + 1;
      if (newline >= 0) {
        yield size > maxRequestBytes ? null : Buffer.concat(parts, size).toString('utf8');
        size = 0;
        parts = [];
      }
    }
  }
}

/** Serve one local, read-only tool over MCP stdio for the lifetime of the input stream. */
export async function serveMcp(repository: string, input: Readable, output: Writable): Promise<void> {
  let state: 'new' | 'initializing' | 'ready' = 'new';

  async function handle(frame: string | null): Promise<unknown> {
    if (frame === null) return failure(null, -32600, 'Request exceeds 64 KiB');
    let message: unknown;
    try {
      message = JSON.parse(frame);
    } catch {
      return failure(null, -32700, 'Parse error');
    }
    const parsed = requestSchema.safeParse(message);
    if (!parsed.success) return failure(null, -32600, 'Invalid request');
    const { id, method, params } = parsed.data;
    if (id === undefined) {
      if (method === 'notifications/initialized' && state === 'initializing') state = 'ready';
      return;
    }
    if (method === 'initialize') {
      if (state !== 'new') return failure(id, -32600, 'Already initialized');
      if (!initializeSchema.safeParse(params).success) return failure(id, -32602, 'Invalid initialization parameters');
      state = 'initializing';
      return result(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'coderipple', version: '0.1.0' } });
    }
    if (method === 'ping') return result(id, {});
    if (state !== 'ready') return failure(id, -32002, 'Server not initialized');
    if (method === 'tools/list') return result(id, { tools: [tool] });
    if (method !== 'tools/call') return failure(id, -32601, 'Method not found');

    const call = callSchema.safeParse(params);
    if (!call.success || call.data.name !== tool.name) return failure(id, -32602, 'Unknown or invalid tool call');
    const args = argumentsSchema.safeParse(call.data.arguments);
    if (!args.success) return result(id, toolFailure('Expected base and head refs and an optional depth between 0 and 10.'));
    try {
      const report = await analyzeImpact(repository, args.data);
      const text = JSON.stringify(report);
      if (Buffer.byteLength(text) > maxReportBytes) {
        return result(id, toolFailure('Impact report exceeds 4 MiB. Compare a smaller revision range or reduce the depth.'));
      }
      return result(id, { content: [{ type: 'text', text }] });
    } catch (error) {
      return result(id, toolFailure(errorMessage(error)));
    }
  }

  for await (const frame of frames(input)) {
    const response = await handle(frame);
    if (response === undefined) continue;
    await new Promise<void>((resolve, reject) => {
      output.write(`${JSON.stringify(response)}\n`, (error) => error ? reject(error) : resolve());
    });
  }
}
