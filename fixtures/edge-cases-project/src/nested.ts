export function outer(): number {
  function inner(): number {
    return helper();
  }
  return inner();
}

export function helper(): number {
  return 2;
}
