import { useStore } from '../store';
import { esc } from '../utils';

// ТЗ ver.3: блокировка — это 402 (нехватка средств) при отправке, а не приём в статус
// ожидания; баннер честно предупреждает, что попытка оформить заказ будет отклонена.
export default function ShipmentBanner() {
  const { state } = useStore();
  const b = state.buyer;
  if (!b) return null;
  const eff = b.shipmentEffective || 'allowed';
  const cause = b.shipmentEffectiveCause || null;

  if (cause === 'no_contract') {
    return (
      <div className="banner banner--no-contract" style={{ marginBottom: 14 }}>
        <strong>Нет действующего договора поставки.</strong> Оформить заказ не получится — обратитесь к менеджеру.
      </div>
    );
  }
  if (eff === 'blocked') {
    return (
      <div className="banner banner--hold" style={{ marginBottom: 14 }}>
        <strong>Отгрузка сейчас приостановлена.</strong> Заказ будет отклонён при отправке (не хватает средств).
        {' '}{esc(b.shipmentEffectiveReason || b.shipmentBlockReason || '')} Обратитесь к менеджеру.
      </div>
    );
  }
  return null;
}
