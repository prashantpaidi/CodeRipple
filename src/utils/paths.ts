import path from 'node:path';

/** File extensions CodeRipple analyzes. */
export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

/** Directories that are always skipped during discovery. */
export const DEFAULT_IGNORED_DIRECTORIES = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.git',
] as const;

/**
 * Convert an OS-specific path to a forward-slash path.
 *
 * All node IDs and stored paths use POSIX separators so that output is
 * identical regardless of the machine that produced it.
 */
export function toPosixPath(value: string): string {
  return value.split(path.sep).join('/').split('\\').join('/');
}

/** Return `absolute` expressed relative to `from`, using POSIX separators. */
export function toRelativePosix(from: string, absolute: string): string {
  return toPosixPath(path.relative(from, absolute));
}

/** True when the path has one of the supported source extensions. */
export function hasSourceExtension(filePath: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

/** True for TypeScript declaration files (`.d.ts`), which we do not analyze. */
export function isDeclarationFile(filePath: string): boolean {
  return filePath.endsWith('.d.ts');
}

/** Heuristic: treat `.min.js` / `.min.ts` style bundles as generated noise. */
export function isMinifiedFile(filePath: string): boolean {
  return /\.min\.(?:[cm]?[jt]sx?)$/.test(filePath);
}

/**
 * Collapse all runs of whitespace (including newlines) into a single space.
 * Used to keep recorded expressions stable across formatting differences.
 */
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Deterministic lexicographic comparison usable directly with `Array#sort`. */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
