export class Rectangle {
  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  area(): number {
    return this.multiply(this.width, this.height);
  }

  private multiply(a: number, b: number): number {
    return a * b;
  }

  get perimeter(): number {
    return 2 * (this.width + this.height);
  }

  static create(width: number, height: number): Rectangle {
    return new Rectangle(width, height);
  }

  describe = (): string => {
    return `area=${this.area()}`;
  };
}

export function areaOf(width: number, height: number): number {
  const rectangle = new Rectangle(width, height);
  return rectangle.area();
}
