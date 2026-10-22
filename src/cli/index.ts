#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';

import { analyzeRepository, formatSummary } from './analyze.js';

const USAGE = `CodeRipple — trace the impact of every code change.

Usage:
  coderipple analyze <repository-path> [options]

Options:
  -o, --output <file>   Write the code graph JSON to <file>.
      --no-gitignore    Do not honor the repository root .gitignore.
  -h, --help            Show this help.

Examples:
  coderipple analyze ./fixtures/basic-project
  coderipple analyze ./fixtures/basic-project --output ./coderipple.json`;

interface AnalyzeArgs {
  repository: string;
  output?: string;
  respectGitignore: boolean;
}

class UsageError extends Error {}

function parseAnalyzeArgs(args: readonly string[]): AnalyzeArgs {
  let repository: string | undefined;
  let output: string | undefined;
  let respectGitignore = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === '-o' || arg === '--output') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new UsageError(`Missing value for ${arg}`);
      }
      output = value;
      index += 1;
    } else if (arg === '--no-gitignore') {
      respectGitignore = false;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else if (repository === undefined) {
      repository = arg;
    } else {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
  }

  if (repository === undefined) {
    throw new UsageError('Missing required <repository-path> argument');
  }

  return output === undefined
    ? { repository, respectGitignore }
    : { repository, output, respectGitignore };
}

function displayPath(absolute: string): string {
  const relative = path.relative(process.cwd(), absolute);
  return relative === '' || relative.startsWith('..') ? absolute : relative;
}

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return command === undefined ? 1 : 0;
  }

  if (command !== 'analyze') {
    process.stderr.write(`Unknown command: ${command}\n\n${USAGE}\n`);
    return 1;
  }

  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  let args: AnalyzeArgs;
  try {
    args = parseAnalyzeArgs(rest);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${USAGE}\n`);
      return 1;
    }
    throw error;
  }

  try {
    const result = analyzeRepository(args.repository, {
      respectGitignore: args.respectGitignore,
      ...(args.output === undefined ? {} : { output: args.output }),
    });
    process.stdout.write(
      `${formatSummary(result.graph, result.outputPath ? displayPath(result.outputPath) : null)}\n`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Analysis failed: ${message}\n`);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
