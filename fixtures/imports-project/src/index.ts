import { add, subtract } from '@/lib/math';
import { formatNumber } from './helpers/format';
import * as math from './lib/math';

export function run(): string {
  const sum = add(1, 2);
  const difference = subtract(sum, 1);
  const extra = math.add(difference, 1);
  return formatNumber(extra);
}
