import { fmtMoneyShort } from '../utils';
import type { Buyer } from '../types';

export function ShipmentPill({ buyer }: { buyer: Buyer | null }) {
  if (!buyer) return null;
  const eff = buyer.shipmentEffective || 'allowed';
  const cause = buyer.shipmentEffectiveCause || null;
  const mode = buyer.shipmentMode;
  let label = '';
  let cls = '';
  let hint = '';
  if (cause === 'no_contract') {
    label = 'Отгрузка — нет договора'; cls = 'ship--blocked'; hint = buyer.shipmentEffectiveReason || '';
  } else if (mode === 'allowed') {
    label = 'Отгрузка разрешена'; cls = 'ship--ok'; hint = '';
  } else if (mode === 'blocked') {
    label = 'Отгрузка запрещена'; cls = 'ship--blocked'; hint = buyer.shipmentBlockReason || '';
  } else {
    if (eff === 'allowed') { label = 'Отгрузка по сальдо · ОК'; cls = 'ship--balance-ok'; hint = 'Проверка по текущему сальдо'; }
    else { label = 'Отгрузка по сальдо · стоп'; cls = 'ship--balance-stop'; hint = buyer.shipmentEffectiveReason || ''; }
  }
  return <span className={'ship-pill ' + cls} title={hint}>{label}</span>;
}

export function BalancePill({ buyer }: { buyer: Buyer | null }) {
  if (!buyer) return null;
  const bal = buyer.balance || 0;
  const cls = bal < 0 ? 'bal--neg' : bal > 0 ? 'bal--pos' : 'bal--zero';
  return <span className={'bal-pill ' + cls}>Сальдо: {fmtMoneyShort(bal)}</span>;
}

export function EdiPill({ buyer }: { buyer: Buyer | null }) {
  if (!buyer || !buyer.usesEdi || !buyer.ediClientCode) return null;
  return (
    <span className="edi-pill" title="Клиент работает по ЭДО. Номер в системе электронного документооборота">
      EDI: {buyer.ediClientCode}
    </span>
  );
}
