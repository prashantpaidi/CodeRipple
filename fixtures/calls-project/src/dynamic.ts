import { readFileSync } from 'node:fs';

export interface Mailer {
  send(message: string): void;
}

export function readConfig(path: string): string {
  return readFileSync(path, 'utf8');
}

export function dispatch(
  handlers: Record<string, () => void>,
  key: string,
): void {
  handlers[key]();
}

export function notify(mailer: Mailer): void {
  mailer.send('hello');
}

export function callUnknown(): void {
  someGlobalFunction();
}
