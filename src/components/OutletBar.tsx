import { useStore, useLoaders, currentOutletOf } from '../store';
import { esc, outletAcceptsDate, parseDate, firstAllowedDate } from '../utils';
import type { ChangeEvent } from 'react';
import type { Route, StatePatch } from '../types';

const OUTLET_BAR_ROUTES = new Set<Route>(['order', 'orders']);

export default function OutletBar() {
  const { state, patch } = useStore();
  const { loadMatrix } = useLoaders();

  if (!OUTLET_BAR_ROUTES.has(state.route)) return null;
  // На экране параметров заказа получателя выбирают в самой карточке —
  // синяя плашка тут была бы дублем, показываем её только после подтверждения
  if (state.route === 'order' && !state.orderReady) return null;

  const ol = currentOutletOf(state);
  if (!ol) return null;
  const multi = state.role === 'buyer' && state.outlets && state.outlets.length > 1;

  // На Истории заказов плашка фильтрует список и умеет «Все точки»
  if (state.route === 'orders' && multi) {
    const f = state.ordersOutletFilter;
    return (
      <div className="outlet-bar">
        <span className="outlet-bar__tag">ТОЧКА</span>
        <select
          id="historyOutletSel" className="outlet-bar__select" aria-label="Фильтр заказов по точке"
          value={f} onChange={(e) => patch({ ordersOutletFilter: e.target.value === 'all' ? 'all' : Number(e.target.value) })}
        >
          <option value="all">Все точки · {state.outlets.length}</option>
          {state.outlets.map((o) => (
            <option key={o.id} value={o.id}>{o.name} · {o.code}{o.address ? ' — ' + o.address : ''}</option>
          ))}
        </select>
      </div>
    );
  }

  function onOutletChange(e: ChangeEvent<HTMLSelectElement>) {
    const newId = Number(e.target.value);
    if (newId === state.currentOutletId) return;
    const patchObj: StatePatch = { currentOutletId: newId };
    const nol = state.outlets.find((o) => o.id === newId);
    if (!outletAcceptsDate(nol, parseDate(state.orderDate))) patchObj.orderDate = firstAllowedDate(nol);
    patch(patchObj);
    setTimeout(loadMatrix, 0);
  }

  return (
    <div className="outlet-bar">
      <span className="outlet-bar__tag">ТОЧКА</span>
      {multi ? (
        <select id="outletSel" className="outlet-bar__select" aria-label="Выбор точки отгрузки" value={state.currentOutletId ?? ''} onChange={onOutletChange}>
          {state.outlets.map((o) => (
            <option key={o.id} value={o.id}>{o.name} · {o.code}{o.address ? ' — ' + o.address : ''}</option>
          ))}
        </select>
      ) : (
        <div className="outlet-bar__static">
          <strong>{esc(ol.name)}</strong>
          <span className="outlet-bar__code">{esc(ol.code)}</span>
          {ol.address ? <span className="outlet-bar__addr">{esc(ol.address)}</span> : null}
        </div>
      )}
    </div>
  );
}
