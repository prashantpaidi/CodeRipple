export class Factory {
  build(): string {
    return 'instance';
  }

  static build(): string {
    return 'static';
  }
}
