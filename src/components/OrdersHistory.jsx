import { useStore, useOrderActions } from '../store.jsx';
import { esc, parseDate, fmtDateShort, fmtMoney } from '../utils.js';

export default function OrdersHistory() {
  const { state } = useStore();
  const { openOrderModal } = useOrderActions();

  let scope = (state.ordersAll || []).slice();
  const f = state.ordersOutletFilter;
  const filtered = state.role === 'buyer' && f && f !== 'all';
  if (filtered) scope = scope.filter((o) => String(o.outletId) === String(f));
  scope.sort((a, b) => {
    const da = parseDate(a.deliveryDate), db = parseDate(b.deliveryDate);
    const ta = da ? da.getTime() : 0, tb = db ? db.getTime() : 0;
    if (tb !== ta) return tb - ta;
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return cb - ca;
  });

  const scopeNote = <div className="orders-history__scope-note">Показаны заказы за последние 14 дней и все незавершённые.</div>;

  if (!scope.length) {
    return (
      <div className="card">
        <div className="empty">{filtered ? 'По выбранной точке заказов нет. Выберите «Все точки», чтобы увидеть остальные.' : 'Заказов пока нет.'}</div>
        {scopeNote}
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>
          История заказов · <span style={{ color: 'var(--gray-600)', fontWeight: 400 }}>{scope.length}{filtered ? ' из ' + (state.ordersAll || []).length : ''}</span>
        </h3>
      </div>
      {scopeNote}
      <table className="table orders-history__table">
        <thead>
          <tr><th>№</th><th>Точка</th><th>Создан</th><th>Доставка</th><th>Позиций</th><th>Сумма</th><th>Статус</th></tr>
        </thead>
        <tbody>
          {scope.map((o) => (
            <tr key={o.id} onClick={() => openOrderModal(o)}>
              <td><strong>{o.orderNumber}</strong></td>
              <td><span style={{ fontSize: 12, color: 'var(--gray-600)', fontFamily: "'Ubuntu Mono',monospace" }}>{esc(o.outletCode || '')}</span><br />{esc(o.outletName || '')}</td>
              <td>{fmtDateShort(o.createdAt)}</td>
              <td>{fmtDateShort(o.deliveryDate)}</td>
              <td>{o.totalUnits} шт.</td>
              <td><strong>{fmtMoney(o.total)}</strong></td>
              <td><span className={'pill pill--' + o.pill}>{o.state}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="orders-history__cards">
        {scope.map((o) => (
          <article key={o.id} className="order-card" onClick={() => openOrderModal(o)}>
            <div className="order-card__top">
              <strong className="order-card__num">№{o.orderNumber}</strong>
              <span className={'pill pill--' + o.pill}>{o.state}</span>
            </div>
            <div className="order-card__meta">
              <span>Создан: {fmtDateShort(o.createdAt)}</span>
              <span>Доставка: {fmtDateShort(o.deliveryDate)}</span>
            </div>
            <div className="order-card__outlet">{esc(o.outletName || '')} <span style={{ color: 'var(--gray-600)', fontFamily: "'Ubuntu Mono',monospace", fontSize: 12 }}>· {esc(o.outletCode || '')}</span></div>
            <div className="order-card__foot">
              <span className="order-card__items">{o.totalUnits} шт.</span>
              <strong className="order-card__sum">{fmtMoney(o.total)}</strong>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
