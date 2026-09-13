import { useStore, currentOutletOf } from '../store.jsx';
import { esc, GROUPS, ORDER_TYPES, fmtDateFull, outletMinSum } from '../utils.js';
import ShipmentBanner from './ShipmentBanner.jsx';
import CategoryChips, { matchType, matchSearch, matchCats } from './CategoryChips.jsx';
import ProductRow from './ProductRow.jsx';
import OrderSummary from './OrderSummary.jsx';

export default function OrderCatalog() {
  const { state, patch } = useStore();
  const ol = currentOutletOf(state);
  const minSum = outletMinSum(ol, state.buyer);
  const search = (state.productSearch || '').toLowerCase().trim();
  const visible = state.products.filter((p) => matchType(p, state.filter, state.cart) && matchCats(p, state.categories) && matchSearch(p, search));

  const cartItems = Object.keys(state.cart).map((pid) => {
    const p = state.products.find((x) => x.id === Number(pid));
    return p ? { p, qty: state.cart[pid] } : null;
  }).filter(Boolean);
  const totalUnits = cartItems.reduce((a, c) => a + c.qty, 0);
  const totalSum = cartItems.reduce((a, c) => a + c.p.price * c.qty, 0);
  const belowMin = totalSum > 0 && totalSum < minSum;

  const groupLbl = GROUPS.find((g) => g.key === Number(state.orderGroup)).label;

  return (
    <>
      <ShipmentBanner />
      <div className="order-params">
        <div className="order-params__item order-params__item--static">
          <label className="order-params__label">Группа</label>
          <div className="order-params__static">{groupLbl}</div>
        </div>
        <div className="order-params__item order-params__item--static">
          <label className="order-params__label">Дата отгрузки</label>
          <div className="order-params__static">{fmtDateFull(state.orderDate)}</div>
        </div>
        <div className="order-params__spacer" />
        <div className="seg seg--type">
          {ORDER_TYPES.map((t) => (
            <button
              key={t.key} type="button" className={'seg__btn' + (state.filter === t.key ? ' is-active' : '')}
              onClick={() => patch({ filter: t.key })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <CategoryChips q={search} />

      <div className="order-form">
        <div className="catalog-col">
          <div className="card">
            <div className="catalog-head">
              <h3 className="card__title" style={{ margin: 0, flex: 1, minWidth: 180 }}>
                Каталог продукции <span style={{ color: 'var(--gray-600)', fontWeight: 400, fontSize: 14 }}>· {visible.length}</span>
              </h3>
              <input
                type="text" value={state.productSearch || ''} placeholder="Поиск по коду или названию..." className="catalog-search"
                onChange={(e) => patch({ productSearch: e.target.value })}
              />
            </div>
            <div className="product-list-header">
              <div className="plh__name">Наименование</div>
              <div className="plh__price">Цена</div>
              <div className="plh__col">Лотки</div>
              <div className="plh__col">Штуки</div>
              <div className="plh__col">Итого штук</div>
            </div>
            <div className="product-list">
              {state.matrixLoading ? (
                <div className="empty">Загружаем матрицу продукции…</div>
              ) : state.matrixError ? (
                <div className="empty">{esc(state.matrixError)}</div>
              ) : visible.length ? (
                visible.map((p) => <ProductRow key={p.id} p={p} />)
              ) : (
                <div className="empty">Ничего не найдено.</div>
              )}
            </div>
          </div>
        </div>
        <OrderSummary cartItems={cartItems} totalUnits={totalUnits} totalSum={totalSum} belowMin={belowMin} minSum={minSum} />
      </div>
    </>
  );
}
