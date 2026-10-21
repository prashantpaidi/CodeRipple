export class Temperature {
  private celsius = 0;

  get value(): number {
    return this.celsius;
  }

  set value(next: number) {
    this.celsius = next;
  }
}
