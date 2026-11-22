import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { impactReportSchema } from '../src/impact/impact-report.js';
import { repoRoot, runCommand } from './helpers.js';

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  dependencies: Record<string, string>;
};

const localEnv = {
  ...process.env,
  NODE_OPTIONS: undefined,
  NODE_PATH: undefined,
  NEO4J_URI: undefined,
  NEO4J_PASSWORD: undefined,
  OPENAI_API_KEY: undefined,
  CODERIPPLE_OPENAI_MODEL: undefined,
};

function output(command: string, args: string[], cwd: string): string {
  const result = runCommand(command, args, cwd, localEnv);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

describe('release candidate tarball', () => {
  let directory: string;
  let firstTarball: string;
  let secondTarball: string;
  let cli: string;
  const demo = 'checkout-demo';
  const impactArgs = ['impact', demo, '--base', 'demo-base', '--head', 'demo-head', '--format', 'json'];

  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coderipple-release-'));
    const pack = (name: string) => {
      const destination = path.join(directory, name);
      fs.mkdirSync(destination);
      output('pnpm', ['pack', '--silent', '--pack-destination', destination], repoRoot);
      return path.join(destination, `${manifest.name}-${manifest.version}.tgz`);
    };
    firstTarball = pack('first');
    secondTarball = pack('second');
    output('tar', ['-xzf', firstTarball], directory);
    const installed = path.join(directory, 'package');
    const modules = path.join(installed, 'node_modules');
    fs.mkdirSync(modules);
    // Use locked runtime dependencies already present in the checkout so this
    // smoke test can run without a registry or a pre-warmed package store.
    for (const name of Object.keys(manifest.dependencies)) {
      fs.symlinkSync(fs.realpathSync(path.join(repoRoot, 'node_modules', name)), path.join(modules, name), 'junction');
    }
    const packedManifest = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')) as {
      bin: { coderipple: string };
    };
    cli = path.resolve(installed, packedManifest.bin.coderipple);
    output('bash', [path.join(installed, 'examples/checkout-demo/setup.sh'), demo], directory);
  }, 120_000);

  afterAll(() => {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  it('packs identical archives with the compiled executable, docs and demo', () => {
    expect(fs.readFileSync(firstTarball).equals(fs.readFileSync(secondTarball))).toBe(true);
    const files = output('tar', ['-tzf', firstTarball], directory).trim().split('\n');
    expect(files).toEqual(expect.arrayContaining([
      'package/dist/cli/index.js', 'package/dist/index.d.ts', 'package/docs/install.md',
      'package/CHANGELOG.md', 'package/examples/checkout-demo/test/checkout.test.mjs',
    ]));
    expect(files.some((file) => /^package\/(?:src|tests|node_modules)\//.test(file))).toBe(false);
    expect(output(cli, ['--version'], directory)).toBe(`${manifest.version}\n`);
  });

  it('reports stable demo evidence, leaves dynamic dispatch unresolved, and respects depth zero', () => {
    const json = output(cli, impactArgs, directory);
    expect(output(cli, impactArgs, directory)).toBe(json);
    const report = impactReportSchema.parse(JSON.parse(json));
    expect(report.changedSymbols.map(({ nodeId, changeType }) => [nodeId, changeType]))
      .toEqual([['src/pricing.mjs::shippingFee', 'MODIFIED']]);
    expect(report.impactPaths).toContainEqual(expect.objectContaining({
      nodeIds: ['src/checkout.mjs::checkout', 'src/order.mjs::createOrder', 'src/pricing.mjs::shippingFee'],
      level: 'transitively-dependent',
    }));
    expect(report.testRecommendations).toEqual([expect.objectContaining({
      testFile: 'test/checkout.test.mjs', confidence: 'static-call',
    })]);
    expect(report.affectedFiles).toContainEqual(expect.objectContaining({
      node: expect.objectContaining({ id: 'src/dispatch.mjs' }), level: 'potential-module-impact',
    }));
    expect(report.unresolvedReferences).toContainEqual(expect.objectContaining({
      reference: expect.objectContaining({
        caller: 'src/dispatch.mjs::quoteByName', reason: 'DYNAMIC_PROPERTY_ACCESS',
      }),
    }));
    expect(report.impactPaths.some(({ edges }) =>
      edges.some((edge) => edge.from === 'src/dispatch.mjs::quoteByName' && edge.type === 'CALLS'))).toBe(false);

    const zeroDepth = impactReportSchema.parse(JSON.parse(output(cli, [...impactArgs, '--depth', '0'], directory)));
    expect(zeroDepth.changedSymbols).toEqual(report.changedSymbols);
    expect(zeroDepth.unresolvedReferences).toEqual(report.unresolvedReferences);
    expect(zeroDepth.testRecommendations).toEqual([]);
    expect(zeroDepth.impactPaths.every(({ edges }) => edges.every(({ type }) => type === 'CONTAINS'))).toBe(true);
    output(process.execPath, ['--test', path.join(demo, 'test/checkout.test.mjs')], directory);
  });

  it('serves the same report over MCP and rejects requests outside the tool contract', () => {
    const request = (id: number, method: string, params?: object) =>
      JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const call = (id: number, args: object) =>
      request(id, 'tools/call', { name: 'analyze_impact', arguments: args });
    const refs = { base: 'demo-base', head: 'demo-head' };
    const transcript = [
      request(1, 'tools/list'),
      '{',
      'x'.repeat(66_000),
      request(2, 'initialize', {
        protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' },
      }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      request(3, 'tools/list'),
      call(4, refs),
      call(5, { ...refs, repository: '..' }),
      call(6, { ...refs, depth: 11 }),
      call(7, { ...refs, base: '--help' }),
      request(8, 'ping'),
      '',
    ].join('\n');
    const result = runCommand(cli, ['mcp', demo], directory, localEnv, transcript);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const messages = result.stdout.trimEnd().split('\n').map((line) => JSON.parse(line));
    expect(messages.map((message) => message.error?.code ?? message.id))
      .toEqual([-32002, -32700, -32600, 2, 3, 4, 5, 6, 7, 8]);
    expect(messages[3].result).toMatchObject({
      protocolVersion: '2025-11-25', serverInfo: { name: 'coderipple', version: manifest.version },
    });
    expect(messages[4].result.tools).toEqual([expect.objectContaining({
      name: 'analyze_impact', annotations: { readOnlyHint: true, openWorldHint: false },
    })]);
    expect(JSON.parse(messages[5].result.content[0].text))
      .toEqual(JSON.parse(output(cli, impactArgs, directory)));
    expect(messages.slice(6, 9).map((message) => message.result.isError)).toEqual([true, true, true]);
    expect(messages[8].result.content[0].text).toContain('Invalid base ref');
    expect(messages[9].result).toEqual({});

    const invalidStartup = runCommand(cli, ['mcp', 'missing-repository'], directory, localEnv);
    expect(invalidStartup.status).toBe(1);
    expect(invalidStartup.stdout).toBe('');
    expect(invalidStartup.stderr).toContain('Repository path does not exist');
  });
});
