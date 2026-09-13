export function createRequestGate() {
  const sequence = new Map();
  return {
    begin(key) {
      const id = (sequence.get(key) || 0) + 1;
      sequence.set(key, id);
      return id;
    },
    isLatest(key, id) {
      return sequence.get(key) === id;
    },
  };
}
