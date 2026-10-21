import { parse } from './overloads';

export function parseAll(values: string[]): number {
  return values.map((value) => parse(value)).length;
}
