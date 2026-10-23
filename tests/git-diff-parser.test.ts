import { describe, expect, it } from 'vitest';

import { parseGitDiff, parseNameStatus, parsePatchRanges } from '../src/git/diff-parser.js';

describe('parseNameStatus', () => {
  it('parses added, modified and deleted entries', () => {
    const output = 'A\0src/new.ts\0M\0src/mod.ts\0D\0src/gone.ts\0';

    expect(parseNameStatus(output)).toEqual([
      { changeType: 'ADDED', newPath: 'src/new.ts' },
      { changeType: 'MODIFIED', oldPath: 'src/mod.ts', newPath: 'src/mod.ts' },
      { changeType: 'DELETED', oldPath: 'src/gone.ts' },
    ]);
  });

  it('parses rename entries with their similarity score', () => {
    const output = 'R087\0src/old.ts\0src/new.ts\0';

    expect(parseNameStatus(output)).toEqual([
      { changeType: 'RENAMED', oldPath: 'src/old.ts', newPath: 'src/new.ts' },
    ]);
  });

  it('preserves paths containing spaces', () => {
    const output = 'M\0src/my file.ts\0';

    expect(parseNameStatus(output)).toEqual([
      { changeType: 'MODIFIED', oldPath: 'src/my file.ts', newPath: 'src/my file.ts' },
    ]);
  });

  it('returns nothing for an empty diff', () => {
    expect(parseNameStatus('')).toEqual([]);
  });
});

describe('parsePatchRanges', () => {
  function withFile(body: string): string {
    return `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n${body}`;
  }

  it('maps a single hunk to both sides', () => {
    const patch = withFile('@@ -10,3 +10,5 @@\n context\n');

    expect(parsePatchRanges(patch)).toEqual([
      {
        oldPath: 'src/a.ts',
        newPath: 'src/a.ts',
        oldRanges: [{ startLine: 10, endLine: 12 }],
        newRanges: [{ startLine: 10, endLine: 14 }],
      },
    ]);
  });

  it('defaults a missing count to one line', () => {
    const patch = withFile('@@ -10 +10 @@\n context\n');

    expect(parsePatchRanges(patch)[0]?.oldRanges).toEqual([{ startLine: 10, endLine: 10 }]);
    expect(parsePatchRanges(patch)[0]?.newRanges).toEqual([{ startLine: 10, endLine: 10 }]);
  });

  it('does not invent a range for a zero-length old side', () => {
    const patch = withFile('@@ -10,0 +11,3 @@\n+add\n');

    const [file] = parsePatchRanges(patch);
    expect(file?.oldRanges).toEqual([]);
    expect(file?.newRanges).toEqual([{ startLine: 11, endLine: 13 }]);
  });

  it('does not invent a range for a zero-length new side', () => {
    const patch = withFile('@@ -10,3 +10,0 @@\n-remove\n');

    const [file] = parsePatchRanges(patch);
    expect(file?.oldRanges).toEqual([{ startLine: 10, endLine: 12 }]);
    expect(file?.newRanges).toEqual([]);
  });

  it('collects every hunk in a file', () => {
    const patch = withFile(
      '@@ -10,1 +10,1 @@\n a\n@@ -20,2 +21,2 @@\n b\n',
    );

    const [file] = parsePatchRanges(patch);
    expect(file?.oldRanges).toEqual([
      { startLine: 10, endLine: 10 },
      { startLine: 20, endLine: 21 },
    ]);
    expect(file?.newRanges).toEqual([
      { startLine: 10, endLine: 10 },
      { startLine: 21, endLine: 22 },
    ]);
  });

  it('reads paths that contain spaces (tab-terminated header)', () => {
    const patch = [
      'diff --git a/sp ace.ts b/sp ace.ts',
      '--- a/sp ace.ts\t',
      '+++ b/sp ace.ts\t',
      '@@ -2,0 +3,1 @@',
      '+x',
      '',
    ].join('\n');

    expect(parsePatchRanges(patch)).toEqual([
      {
        oldPath: 'sp ace.ts',
        newPath: 'sp ace.ts',
        oldRanges: [],
        newRanges: [{ startLine: 3, endLine: 3 }],
      },
    ]);
  });

  it('records an added file with only a new-side range', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/a.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
      '',
    ].join('\n');

    expect(parsePatchRanges(patch)).toEqual([
      {
        newPath: 'src/a.ts',
        oldRanges: [],
        newRanges: [{ startLine: 1, endLine: 2 }],
      },
    ]);
  });

  it('records a deleted file with only an old-side range', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      'deleted file mode 100644',
      '--- a/src/a.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
      '',
    ].join('\n');

    expect(parsePatchRanges(patch)).toEqual([
      {
        oldPath: 'src/a.ts',
        oldRanges: [{ startLine: 1, endLine: 2 }],
        newRanges: [],
      },
    ]);
  });

  it('ignores a pure rename (no hunks)', () => {
    const patch = [
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 100%',
      'rename from src/old.ts',
      'rename to src/new.ts',
      '',
    ].join('\n');

    expect(parsePatchRanges(patch)).toEqual([]);
  });

  it('ignores binary file blocks', () => {
    const patch = [
      'diff --git a/logo.png b/logo.png',
      'index 4f75809..8d042e9 100644',
      'Binary files a/logo.png and b/logo.png differ',
      '',
    ].join('\n');

    expect(parsePatchRanges(patch)).toEqual([]);
  });

  it('does not mistake a removed line beginning with --- for a header', () => {
    const patch = withFile('@@ -1,2 +1,1 @@\n keep\n--- removed\n');

    const files = parsePatchRanges(patch);
    expect(files).toHaveLength(1);
    expect(files[0]?.oldPath).toBe('src/a.ts');
    expect(files[0]?.oldRanges).toEqual([{ startLine: 1, endLine: 2 }]);
  });
});

describe('parseGitDiff', () => {
  it('joins name-status classification with patch ranges', () => {
    const nameStatus = 'M\0src/a.ts\0A\0src/b.ts\0';
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -3,1 +3,2 @@',
      ' x',
      '',
      'diff --git a/src/b.ts b/src/b.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/b.ts',
      '@@ -0,0 +1,1 @@',
      '+y',
      '',
    ].join('\n');

    expect(parseGitDiff(nameStatus, patch)).toEqual([
      {
        oldPath: 'src/a.ts',
        newPath: 'src/a.ts',
        changeType: 'MODIFIED',
        oldRanges: [{ startLine: 3, endLine: 3 }],
        newRanges: [{ startLine: 3, endLine: 4 }],
      },
      {
        newPath: 'src/b.ts',
        changeType: 'ADDED',
        oldRanges: [],
        newRanges: [{ startLine: 1, endLine: 1 }],
      },
    ]);
  });

  it('leaves a binary change with empty ranges', () => {
    const nameStatus = 'M\0logo.png\0';
    const patch = [
      'diff --git a/logo.png b/logo.png',
      'index 4f75809..8d042e9 100644',
      'Binary files a/logo.png and b/logo.png differ',
      '',
    ].join('\n');

    expect(parseGitDiff(nameStatus, patch)).toEqual([
      { oldPath: 'logo.png', newPath: 'logo.png', changeType: 'MODIFIED', oldRanges: [], newRanges: [] },
    ]);
  });

  it('sorts files deterministically and dedupes repeated ranges', () => {
    const nameStatus = 'M\0src/b.ts\0M\0src/a.ts\0';
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -5,1 +5,1 @@',
      ' x',
      '@@ -5,1 +5,1 @@',
      ' y',
      '',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1,1 +1,1 @@',
      ' z',
      '',
    ].join('\n');

    const files = parseGitDiff(nameStatus, patch);
    expect(files.map((file) => file.newPath)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(files[0]?.newRanges).toEqual([{ startLine: 5, endLine: 5 }]);
  });

  it('returns nothing when both inputs are empty', () => {
    expect(parseGitDiff('', '')).toEqual([]);
  });
});
