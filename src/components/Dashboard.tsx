import { useStore, currentOutletOf, useOrderActions } from '../store';
import {
  parseDate, plural, fmtMoney, fmtMoneyShort, fmtDateShort, esc, outletMinSum,
} from '../utils';
import { ShipmentPill } from './Pills';
import { IconPlus } from '../icons';
import type { Role, Route } from '../types';

function showsBalance(role: Role | null): boolean { return role === 'buyer'; }

export default function Dashboard({ goto }: { goto: (route: Route) => void }) {
  const { state, patch } = useStore();
  const { openOrderModal } = useOrderActions();
  const b = state.buyer;
  if (!b) return null;
  const ol = currentOutletOf(state);
  const scope = state.ordersAll || [];
  const multiOutlet = state.role === 'buyer' && state.outlets && state.outlets.length > 1;

  const pendingOrders = scope
    .filter((o) => o.status !== 'shipped' && o.status !== 'deleted')
    .slice()
    .sort((a, c) => {
      const da = parseDate(a.deliveryDate), dc = parseDate(c.deliveryDate);
      return (da ? da.getTime() : 0) - (dc ? dc.getTime() : 0);
    });

  const thisMonthOrders = scope.filter((o) => {
    if (!o.createdAt) return false;
    const d = new Date(o.createdAt); const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const totalMonth = thisMonthOrders.reduce((a, c) => a + (c.total || 0), 0);

  const cause = b.shipmentEffectiveCause || null;
  const eff = b.shipmentEffective || 'allowed';
  let shipBanner = null;
  if (cause === 'no_contract') {
    shipBanner = (
      <div className="banner banner--no-contract">
        <strong>Нет действующего договора поставки.</strong> Отгрузка невозможна до оформления договора.
        {' '}Свяжитесь с вашим менеджером: <strong>{esc(b.manager || '')}</strong>, {esc(b.managerPhone || '')}.
      </div>
    );
  } else if (eff === 'blocked' || (b.shipmentMode === 'balance' && (b.balance || 0) < 0)) {
    let reasonTxt = String(b.shipmentEffectiveReason || b.shipmentBlockReason || '').trim();
    if (reasonTxt && !/[.…!?]$/.test(reasonTxt)) reasonTxt += '.';
    // ТЗ ver.3: блокировка = 402 при отправке (заказ отклоняется), а не приём в статус
    // ожидания — баннер больше не обещает несуществующий «hold»-статус.
    shipBanner = (
      <div className="banner banner--warn">
        <strong>Отгрузка приостановлена.</strong> {reasonTxt} Новый заказ будет отклонён при отправке — обратитесь к менеджеру.
      </div>
    );
  } else if (b.shipmentMode === 'balance') {
    shipBanner = (
      <div className="banner banner--info">
        <strong>Отгрузка по текущему сальдо.</strong> Заказ будет отгружен, пока сальдо не уходит в минус.
      </div>
    );
  }

  const minSum = outletMinSum(ol, b);

  return (
    <>
      {shipBanner}
      <div className="hero-card">
        <h2>Здравствуйте, {esc(b.name)}!</h2>
        {multiOutlet ? (
          <p>Обслуживаем <strong>{state.outlets.length} {plural(state.outlets.length, 'точку', 'точки', 'точек')}</strong>. Сводка ниже — по всем.</p>
        ) : (
          <p>Точка отгрузки: <strong>{ol ? esc(ol.name) : '—'}</strong>{ol ? <span className="hero-card__code">{esc(ol.code)}</span> : null}</p>
        )}
        <div className="ship-row"><ShipmentPill buyer={b} /></div>
        <div className="actions">
          <button className="btn btn--primary" onClick={() => goto('order')}><IconPlus />Оформить заказ</button>
          <button className="btn btn--ghost" onClick={() => goto('orders')}>История заказов</button>
        </div>
      </div>

      <div className={'grid ' + (showsBalance(state.role) ? 'grid-4' : 'grid-3')} style={{ marginTop: 20 }}>
        <div className="kpi kpi--accent">
          <div className="kpi__label">Заказов в этом месяце</div>
          <div className="kpi__value">{thisMonthOrders.length}</div>
          <div className="kpi__hint">{fmtMoney(totalMonth)} с НДС</div>
        </div>
        <div className="kpi">
          <div className="kpi__label">Активных заказов</div>
          <div className="kpi__value">{pendingOrders.length}</div>
        </div>
        {showsBalance(state.role) ? (
          <div className="kpi">
            <div className="kpi__label">Сальдо</div>
            <div className="kpi__value" style={{ color: (b.balance || 0) < 0 ? 'var(--danger)' : 'var(--blue-ink)' }}>
              {fmtMoneyShort(b.balance || 0)}
            </div>
          </div>
        ) : null}
        {multiOutlet ? (
          <div className="kpi kpi--link" role="button" tabIndex={0} onClick={() => goto('outlets')}>
            <div className="kpi__label">Точек обслуживания</div>
            <div className="kpi__value">{state.outlets.length}</div>
            <div className="kpi__hint">Открыть список получателей</div>
          </div>
        ) : (
          <div className="kpi">
            <div className="kpi__label">Минимальная сумма</div>
            <div className="kpi__value">{fmtMoneyShort(minSum)}</div>
            <div className="kpi__hint">Для точки {ol ? esc(ol.code) : '—'}</div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 20 }}>
        <div className="card">
          <h3 className="card__title">
            Ближайшие поставки
            {multiOutlet ? <span style={{ color: 'var(--gray-600)', fontWeight: 400, fontSize: 14 }}> · по всем точкам</span> : null}
          </h3>
          {pendingOrders.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>№</th>
                  {multiOutlet ? <th>Точка</th> : null}
                  <th>Дата</th><th>Позиций</th><th>Сумма</th><th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {pendingOrders.slice(0, multiOutlet ? 8 : 4).map((o) => (
                  <tr key={o.id} onClick={() => openOrderModal(o)}>
                    <td><strong>{o.orderNumber}</strong></td>
                    {multiOutlet ? <td><span className="cell-code">{esc(o.outletCode || '')}</span><br />{esc(o.outletName || '')}</td> : null}
                    <td>{fmtDateShort(o.deliveryDate)}</td>
                    <td>{o.totalUnits} шт.</td>
                    <td>{fmtMoney(o.total)}</td>
                    <td><span className={'pill pill--' + o.pill}>{o.state}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">Активных заказов нет. Оформите новый — займёт 1 минуту.</div>
          )}
        </div>
      </div>
    </>
  );
}
