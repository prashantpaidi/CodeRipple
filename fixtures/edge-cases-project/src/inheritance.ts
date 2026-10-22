export class Base {
  greet(): string {
    return 'base';
  }
}

export class Derived extends Base {
  shout(): string {
    return this.greet().toUpperCase();
  }
}
