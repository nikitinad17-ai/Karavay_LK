export function createRequestGate() {
  const sequence = new Map<string, number>();
  return {
    begin(key: string): number {
      const id = (sequence.get(key) || 0) + 1;
      sequence.set(key, id);
      return id;
    },
    isLatest(key: string, id: number): boolean {
      return sequence.get(key) === id;
    },
  };
}
