export function useCallback(): number {
  const values = [1, 2, 3];
  return values.map((value) => helper(value)).length;
}

export function helper(value: number): number {
  return value + 1;
}
