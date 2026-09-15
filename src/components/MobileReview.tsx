import { currentOutletOf, useOrderActions, useStore } from '../store';
import { reviewData } from '../orderRules';
import { fmtMoney } from '../utils';

export default function MobileReview() {
  const { state } = useStore();
  const { openOrderReview } = useOrderActions();
  if (state.route !== 'order' || !state.orderReady) return null;
  const data = reviewData(state, currentOutletOf(state));
  return (
    <div className="mobile-review" aria-label="Итог заказа">
      <div><strong>{fmtMoney(data.total)}</strong><span>{data.items.length} поз. · {data.units} шт.</span></div>
      <button type="button" className="btn btn--primary" disabled={!data.canReview} onClick={openOrderReview}>Проверить заказ</button>
    </div>
  );
}
