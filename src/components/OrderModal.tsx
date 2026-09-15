import { useStore, useOrderActions } from '../store';
import {
  esc, fmtDateTime, fmtDateShort, fmtMoney, groupLabel, canCancelOrder, orderChanged,
  orderItemLots, orderItemPcs,
} from '../utils';
import { IconClose } from '../icons';
import { quantityError } from '../orderRules';
import type { OrderItem } from '../types';

export default function OrderModal() {
  const { state } = useStore();
  const { closeOrderModal, applyOrderItemQty, saveOrderEdits, askCancelOrder, repeatOrderFromHistory } = useOrderActions();
  const o = state.modalOrder;
  if (!o) return null;

  const cancelCheck = canCancelOrder(o);
  const canEdit = o.status === 'accepted' && o.items !== null;
  const canCancel = cancelCheck.ok;
  const hasReturns = (o.items || []).some((it) => it.returned > 0);
  // Если в открытом заказе уже есть несохранённые правки — «Повторить заказ» уступает
  // место прямой кнопке сохранения корректировки
  const hasEdits = !!(state.editSnapshot && orderChanged(o, state.editSnapshot));
  const editErrors = (o.items || []).filter((it) => it.qty > 0).map((it) => quantityError(it, it.qty)).filter(Boolean);

  function stepItem(it: OrderItem, which: 'lots' | 'pcs', dir: '+' | '-') {
    const ppl = it.piecesPerLot || 1;
    let q = it.qty;
    if (which === 'lots') q = dir === '+' ? q + ppl : Math.max(0, q - ppl);
    else q = dir === '+' ? q + 1 : Math.max(0, q - 1);
    applyOrderItemQty(o!, it, q);
  }
  function inputItem(it: OrderItem, which: 'lots' | 'pcs', value: string) {
    const ppl = it.piecesPerLot || 1;
    const v = Math.max(0, Math.floor(Number(value) || 0));
    const curLots = orderItemLots(it), curPcs = orderItemPcs(it);
    const newQty = which === 'lots' ? v * ppl + curPcs : curLots * ppl + v;
    applyOrderItemQty(o!, it, newQty);
  }
  function stepFlat(it: OrderItem, dir: '+' | '-') {
    applyOrderItemQty(o!, it, dir === '+' ? it.qty + 1 : Math.max(0, it.qty - 1));
  }

  return (
    <div className="modal-back" onClick={closeOrderModal}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Карточка заказа" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>Заказ №{o.orderNumber}</h3>
          <span className={'pill pill--' + o.pill} style={{ background: 'rgba(255,255,255,.2)', color: '#fff' }}>{o.state}</span>
          <button className="modal__close" onClick={closeOrderModal}><IconClose /></button>
        </div>
        <div className="modal__body">
          {!cancelCheck.ok && o.status !== 'deleted' ? (
            <div className="banner banner--info" style={{ marginBottom: 12 }}>{cancelCheck.reason}</div>
          ) : null}
          {state.orderEditError ? <div className="banner banner--danger" role="alert" style={{ marginBottom: 12 }}>{state.orderEditError}</div> : null}
          <dl className="dl">
            <dt>Получатель</dt><dd>{esc(o.outletName || '—')} <span style={{ color: 'var(--gray-600)' }}>· {esc(o.outletCode || '')}</span></dd>
            <dt>Создан</dt><dd>{fmtDateTime(o.createdAt)}</dd>
            <dt>Дата доставки</dt><dd>{fmtDateShort(o.deliveryDate)}</dd>
            <dt>Группа</dt><dd>{groupLabel(o.group)}</dd>
            <dt>Источник</dt><dd>{o.source || '—'}</dd>
            <dt>Позиций</dt><dd>{o.items ? o.items.length + ' SKU · ' : ''}{o.totalUnits} шт.</dd>
            <dt>Сумма</dt><dd><strong style={{ color: 'var(--blue-ink)' }}>{fmtMoney(o.total)}</strong> с НДС</dd>
          </dl>

          {o.items === null ? (
            <div className="empty">Загружаем позиции заказа…</div>
          ) : (
            <table className="table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Код</th><th>Наименование</th><th>Кол-во</th>
                  {hasReturns ? <th>Возврат</th> : null}
                  <th>Цена</th><th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((it) => {
                  const ppl = it.piecesPerLot || 1;
                  let qtyCell;
                  const itemError = it.qty > 0 ? quantityError(it, it.qty) : '';
                  if (canEdit && ppl > 1) {
                    const lots = orderItemLots(it), pcs = orderItemPcs(it);
                    qtyCell = (
                      <div className={'qty qty--lotonly' + (it.lotOnly ? ' qty--2col' : '')}>
                        <div className="qty__field">
                          <div className="qty__stepper">
                            <button type="button" className="qty__btn" aria-label="−" onClick={() => stepItem(it, 'lots', '-')}>−</button>
                            <input type="text" inputMode="numeric" pattern="[0-9]*" value={lots} onChange={(e) => inputItem(it, 'lots', e.target.value)} />
                            <button type="button" className="qty__btn" aria-label="+" onClick={() => stepItem(it, 'lots', '+')}>+</button>
                          </div>
                          <div className="qty__field-label">лотки</div>
                        </div>
                        {it.lotOnly ? <div className="qty__field qty__field--empty" /> : <div className="qty__field">
                          <div className="qty__stepper">
                            <button type="button" className="qty__btn" aria-label="−" onClick={() => stepItem(it, 'pcs', '-')}>−</button>
                            <input type="text" inputMode="numeric" pattern="[0-9]*" value={pcs} onChange={(e) => inputItem(it, 'pcs', e.target.value)} />
                            <button type="button" className="qty__btn" aria-label="+" onClick={() => stepItem(it, 'pcs', '+')}>+</button>
                          </div>
                          <div className="qty__field-label">штуки</div>
                        </div>}
                        <div className="qty__field">
                          <div className="qty__total">{it.qty}</div>
                          <div className="qty__field-label">итого шт</div>
                        </div>
                      </div>
                    );
                  } else if (canEdit) {
                    qtyCell = (
                      <div className="qty" style={{ justifyContent: 'flex-start' }}>
                        <button className="qty__btn" type="button" disabled={it.qty <= 1} onClick={() => stepFlat(it, '-')}>−</button>
                        <span className="qty__val">{it.qty}</span>
                        <button className="qty__btn" type="button" onClick={() => stepFlat(it, '+')}>+</button>
                        <span style={{ color: 'var(--gray-600)', fontSize: 12, marginLeft: 4 }}>шт</span>
                      </div>
                    );
                  } else {
                    const lots2 = orderItemLots(it), pcs2 = orderItemPcs(it);
                    qtyCell = ppl > 1
                      ? <>{lots2} лот.{pcs2 ? ' + ' + pcs2 + ' шт' : ''} <span style={{ color: 'var(--gray-600)' }}>= {it.qty} шт</span></>
                      : it.qty + ' шт';
                  }
                  return (
                    <tr key={it.code}>
                      <td style={{ color: 'var(--gray-600)', fontSize: 12 }}>{esc(it.code || '')}</td>
                      <td>{esc(it.name)}</td>
                      <td>{qtyCell}{itemError ? <div className="product__validation">{itemError}</div> : null}</td>
                      {hasReturns ? <td>{it.returned ? <span className="ret-badge">{it.returned} шт</span> : '—'}</td> : null}
                      <td>{fmtMoney(it.price)}</td>
                      <td><strong>{fmtMoney(it.sum || it.price * it.qty)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div>
              {canCancel ? <button className="btn btn--danger-outline" type="button" onClick={() => askCancelOrder(o)}>Отменить заказ</button> : null}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn--secondary" onClick={closeOrderModal}>{hasEdits ? 'Отменить правки' : 'Закрыть'}</button>
              {hasEdits ? (
                <button className="btn btn--primary" type="button" disabled={editErrors.length > 0} onClick={() => saveOrderEdits(o, state.editSnapshot)}>Корректировка заказа</button>
              ) : (
                <button className="btn btn--primary" type="button" onClick={() => repeatOrderFromHistory(o)}>Повторить заказ</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
