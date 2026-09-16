export interface DemoAccount {
  readonly code: string;
  readonly label: string;
}

export interface DemoAccountGroups {
  readonly edi: readonly DemoAccount[];
  readonly buyers: readonly DemoAccount[];
  readonly outlets: readonly DemoAccount[];
}

const edi: readonly DemoAccount[] = [
  { code: 'DEMO-B-15', label: 'DEMO-B-15 · Демо-покупатель EDI' },
  { code: 'DEMO-B-16', label: 'DEMO-B-16 · Демо-покупатель EDI' },
];

const buyers: readonly DemoAccount[] = Array.from({ length: 14 }, (_, index) => {
  const id = index + 1;
  const code = `DEMO-B-${String(id).padStart(2, '0')}`;
  const state = id === 2
    ? ' · отрицательное сальдо'
    : id === 4
      ? ' · без договора'
      : id === 8
        ? ' · отгрузка запрещена'
        : '';
  return { code, label: `${code} · Демо-покупатель ${String(id).padStart(2, '0')}${state}` };
});

const outlets: readonly DemoAccount[] = [
  { code: 'DEMO-O-0101', label: 'DEMO-O-0101 · Демо-точка 0101' },
  { code: 'DEMO-O-1101', label: 'DEMO-O-1101 · Демо-точка 1101' },
];

export const demoAccountGroups: DemoAccountGroups = Object.freeze({ edi, buyers, outlets });
