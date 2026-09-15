import { useEffect } from 'react';
import type { ChangeEvent } from 'react';
import { useStore, currentOutletOf, useLoaders, useOrderActions } from '../store';
import { esc, allowedDatesFor, fmtDateFull, fmtDate, outletAcceptsDate, parseDate, firstAllowedDate } from '../utils';
import { IconChevron, IconOrders } from '../icons';
import ShipmentBanner from './ShipmentBanner';
import type { StatePatch } from '../types';

export default function OrderSetup() {
  const { state, patch } = useStore();
  const { loadMatrix, refreshSetupLastOrder } = useLoaders();
  const { repeatLastOrder } = useOrderActions();

  const isBuyerMulti = state.role === 'buyer' && state.outlets && state.outlets.length > 1;
  const ol = currentOutletOf(state);
  const dates = allowedDatesFor(ol, 10);

  // ТЗ ver.3: последний принятый заказ — родной параметр GET /clients/{id_clt}/orders?last=1,
  // кэшируем на точку, чтобы не дёргать API на каждый рендер
  useEffect(() => { refreshSetupLastOrder(ol); }, [ol && ol.id_clt]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastOrder = state.setupLastOrder && state.setupLastOrder !== 'loading' ? state.setupLastOrder : null;
  let stepN = 0;

  function onOutletChange(e: ChangeEvent<HTMLSelectElement>) {
    const newId = Number(e.target.value);
    if (!newId || newId === state.currentOutletId) return;
    const nol = state.outlets.find((o) => o.id === newId);
    const patchObj: StatePatch = { currentOutletId: newId };
    if (!outletAcceptsDate(nol, parseDate(state.orderDate))) patchObj.orderDate = firstAllowedDate(nol);
    patch(patchObj);
  }

  return (
    <>
      <ShipmentBanner />
      <div className="card setup-card">
        <h3 className="card__title">Параметры заказа</h3>
        <div className="setup-steps">
          {isBuyerMulti ? (
            <div className="setup-step">
              <div className="setup-step__num">{++stepN}</div>
              <div className="setup-step__body">
                <label className="setup-step__label" htmlFor="setupOutletSel">Получатель</label>
                <div className="setup-select-wrap">
                  <select id="setupOutletSel" className="setup-select" aria-label="Выбор получателя" value={state.currentOutletId ?? ''} onChange={onOutletChange}>
                    {state.outlets.map((o) => (
                      <option key={o.id} value={o.id}>{o.name} · {o.code}{o.address ? ' — ' + o.address : ''}</option>
                    ))}
                  </select>
                  <span className="setup-select-wrap__chevron"><IconChevron /></span>
                </div>
              </div>
            </div>
          ) : (
            <div className="setup-step setup-step--static">
              <div className="setup-step__body">
                <span className="setup-step__label">Получатель</span>
                <div className="setup-step__static">
                  {ol ? esc(ol.name) : '—'}
                  {ol && ol.code ? <span className="outlet-bar__code" style={{ color: 'var(--gray-600)' }}> {esc(ol.code)}</span> : null}
                </div>
              </div>
            </div>
          )}

          <div className="setup-step">
            <div className="setup-step__num">{++stepN}</div>
            <div className="setup-step__body">
              <label className="setup-step__label" htmlFor="setupDateSel">Дата отгрузки</label>
              <div className="setup-select-wrap">
                <select
                  id="setupDateSel" className="setup-select" aria-label="Дата отгрузки" value={state.orderDate || ''}
                  onChange={(e) => patch({ orderDate: e.target.value })}
                >
                  {dates.map((d) => <option key={d} value={d}>{fmtDateFull(d)}</option>)}
                </select>
                <span className="setup-select-wrap__chevron"><IconChevron /></span>
              </div>
            </div>
          </div>

          <div className="setup-step">
            <div className="setup-step__num">{++stepN}</div>
            <div className="setup-step__body">
              <span className="setup-step__label">Заморозка</span>
              <label className="setup-toggle">
                <input
                  type="checkbox" id="setupFreezeChk" checked={Number(state.orderGroup) === 0}
                  onChange={(e) => patch({ orderGroup: e.target.checked ? 0 : 1 })}
                />
                <span className="setup-toggle__box" aria-hidden="true" />
                <span className="setup-toggle__text">
                  {Number(state.orderGroup) === 0 ? 'Да — замороженная продукция (ЗПФ)' : 'Нет — хлебобулочные изделия (ХБИ)'}
                </span>
              </label>
            </div>
          </div>
        </div>

        {lastOrder ? (
          <div className="setup-repeat">
            <div className="setup-repeat__text">
              Или повторите последний заказ <strong>№{lastOrder.orderNumber || lastOrder.id}</strong>
              {lastOrder.deliveryDate ? ' от ' + fmtDate(lastOrder.deliveryDate) : ''}
            </div>
            <button type="button" className="btn btn--secondary" onClick={repeatLastOrder}><IconOrders />Повторить последний заказ</button>
          </div>
        ) : null}

        <div className="setup-actions">
          <button type="button" className="btn btn--primary" onClick={() => { patch({ orderReady: true }); loadMatrix(); }}>
            Показать прайс-лист <IconChevron />
          </button>
        </div>
      </div>
    </>
  );
}
