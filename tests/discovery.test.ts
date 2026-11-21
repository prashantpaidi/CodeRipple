import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildGraph } from '../src/graph/graph-builder.js';
import { loadRepositoryConfig } from '../src/config/repository-config.js';
import { parseRepository } from '../src/parser/file-parser.js';
import { discoverSourceFiles } from '../src/parser/repository-parser.js';
import { fixture, withGitRepository } from './helpers.js';

describe('repository file discovery', () => {
  it('discovers supported source files recursively', () => {
    const config = loadRepositoryConfig(fixture('basic-project'));
    const files = discoverSourceFiles(config).map((file) => file.relativePath);

    expect(files).toEqual(['src/auth.ts', 'src/index.ts', 'src/user.ts']);
  });

  it('ignores build, dependency, and generated directories', () => {
    const config = loadRepositoryConfig(fixture('gitignore-project'));
    const files = discoverSourceFiles(config).map((file) => file.relativePath);

    expect(files).not.toContain('node_modules/dep/index.js');
    expect(files).not.toContain('dist/bundle.js');
  });

  it('respects .gitignore and can be told to ignore it', () => {
    const config = loadRepositoryConfig(fixture('gitignore-project'));

    const respected = discoverSourceFiles(config)
      .map((file) => file.relativePath)
      .sort();
    expect(respected).toEqual(['src/app.ts', 'src/keep.ts']);

    const disabled = discoverSourceFiles(config, { respectGitignore: false })
      .map((file) => file.relativePath)
      .sort();
    expect(disabled).toEqual([
      'generated/gen.ts',
      'ignored.ts',
      'src/app.ts',
      'src/keep.ts',
    ]);
  });

  it('rejects a repository path that does not exist', () => {
    expect(() => loadRepositoryConfig(fixture('does-not-exist'))).toThrow(
      /does not exist/,
    );
  });

  it('keeps symlinked configuration and implicit TypeScript reads inside the selected root', () => withGitRepository((repo) => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'coderipple-outside-'));
    try {
      fs.writeFileSync(path.join(external, '.gitignore'), 'caller.ts\n');
      fs.writeFileSync(path.join(external, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":"."}}');
      fs.writeFileSync(path.join(external, 'outside.ts'), 'export function external() { return 0; }\n');
      for (const file of ['.gitignore', 'tsconfig.json', 'outside.ts']) {
        fs.symlinkSync(path.join(external, file), path.join(repo.path, file));
      }
      repo.write('caller.ts', "import { external } from './outside.js';\nexport function caller() { return external(); }\n");
      const initial = loadRepositoryConfig(repo.path);
      expect(initial.tsconfigPath).toBeNull();
      expect(discoverSourceFiles(initial).map((file) => file.relativePath)).toEqual(['caller.ts']);
      fs.renameSync(path.join(repo.path, 'tsconfig.json'), path.join(repo.path, 'extended.json'));
      repo.write('tsconfig.json', '{"extends":"./extended.json","compilerOptions":{"moduleResolution":"Bundler","module":"ESNext"}}');
      const config = loadRepositoryConfig(repo.path);
      const parsed = parseRepository(config, discoverSourceFiles(config));
      const graph = buildGraph(config, parsed);
      expect(parsed.project.getCompilerOptions().baseUrl).toBeUndefined();
      expect(parsed.project.getSourceFiles().map((file) => file.getBaseName())).toEqual(['caller.ts']);
      expect(graph.unresolvedReferences).toContainEqual(expect.objectContaining({ caller: 'caller.ts::caller' }));
      expect(graph.edges.every((edge) => edge.type === 'CONTAINS')).toBe(true);
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  }));
});
