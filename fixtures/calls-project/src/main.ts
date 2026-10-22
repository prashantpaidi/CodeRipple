import { Calculator } from './calculator';

export function compute(): number {
  const calculator = new Calculator();
  calculator.addValue(3);
  return calculator.squareTotal();
}
