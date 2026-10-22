import { describe, expect, it } from 'vitest';

import { loadRepositoryConfig } from '../src/config/repository-config.js';
import { discoverSourceFiles } from '../src/parser/repository-parser.js';
import { fixture } from './helpers.js';

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
});
