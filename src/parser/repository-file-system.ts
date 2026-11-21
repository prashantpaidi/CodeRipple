import fs from 'node:fs';
import path from 'node:path';

import { InMemoryFileSystemHost } from 'ts-morph';

import { isWithinPath } from '../utils/paths.js';

/** Constrain TypeScript's implicit reads (imports, types, and config inheritance). */
export class RepositoryFileSystem extends InMemoryFileSystemHost {
  private readonly realRoot: string;

  constructor(private readonly root: string) {
    super();
    this.realRoot = fs.realpathSync(root);
  }

  private resolve(candidate: string): string | undefined {
    if (!isWithinPath(this.root, candidate)) return undefined;
    try {
      const resolved = fs.realpathSync.native(candidate);
      return isWithinPath(this.realRoot, resolved) ? resolved : undefined;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') return undefined;
      throw error;
    }
  }

  override getCurrentDirectory(): string {
    return this.root;
  }

  override realpathSync(candidate: string): string {
    const resolved = this.resolve(candidate);
    return resolved === undefined ? candidate : path.join(this.root, path.relative(this.realRoot, resolved));
  }

  override fileExistsSync(file: string): boolean {
    const resolved = this.resolve(file);
    return resolved !== undefined && fs.statSync(resolved, { throwIfNoEntry: false })?.isFile() === true;
  }

  override async fileExists(file: string): Promise<boolean> {
    return this.fileExistsSync(file);
  }

  override directoryExistsSync(directory: string): boolean {
    const resolved = this.resolve(directory);
    return resolved !== undefined && fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory() === true;
  }

  override async directoryExists(directory: string): Promise<boolean> {
    return this.directoryExistsSync(directory);
  }

  override readFileSync(file: string, encoding: BufferEncoding = 'utf8'): string {
    const resolved = this.resolve(file);
    if (resolved === undefined || !fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
      throw Object.assign(new Error(`File unavailable: ${file}`), { code: 'ENOENT' });
    }
    return fs.readFileSync(resolved, encoding);
  }

  override async readFile(file: string, encoding?: BufferEncoding): Promise<string> {
    return this.readFileSync(file, encoding);
  }

  override readDirSync(directory: string): ReturnType<InMemoryFileSystemHost['readDirSync']> {
    const resolved = this.resolve(directory);
    if (resolved === undefined) return [];
    return fs.readdirSync(resolved, { withFileTypes: true })
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .map((entry) => ({
        name: path.join(directory, entry.name).split(path.sep).join('/'),
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
        isSymlink: false,
      }));
  }
}
