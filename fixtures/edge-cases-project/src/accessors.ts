export class Temperature {
  private celsius = 0;
  private static unit = 'C';

  get value(): number {
    return this.celsius;
  }

  set value(next: number) {
    this.celsius = next;
  }

  static get value(): string {
    return Temperature.unit;
  }

  static set value(next: string) {
    Temperature.unit = next;
  }
}
