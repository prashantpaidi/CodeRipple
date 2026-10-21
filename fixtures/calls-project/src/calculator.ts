import { add, square } from './math';

export class Calculator {
  private total = 0;

  addValue(value: number): number {
    this.total = add(this.total, value);
    return this.total;
  }

  squareTotal(): number {
    this.reset();
    return square(this.total);
  }

  private reset(): void {
    this.total = 0;
  }
}
