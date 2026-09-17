import { useAuth, useStore } from '../store';
import type { ChangeEvent } from 'react';

export default function BuyerSwitcher() {
  const { state } = useStore();
  const { switchBuyer } = useAuth();
  const directory = state.userDirectory;
  const currentId = state.selectedBuyerContext?.buyerId || '';
  if (!directory || !currentId) return null;

  function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const buyerId = event.target.value;
    if (!buyerId || buyerId === currentId) return;
    void switchBuyer(buyerId).catch(() => {});
  }

  return (
    <label className="buyer-switcher">
      <span>Юрлицо</span>
      <select
        aria-label="Текущее юридическое лицо"
        value={currentId}
        disabled={state.buyerSwitching || directory.accesses.length < 2}
        onChange={onChange}
      >
        {directory.accesses.map(({ buyer, membership }) => (
          <option key={membership.id} value={membership.buyerId}>{buyer.name} · {buyer.code}</option>
        ))}
      </select>
    </label>
  );
}
