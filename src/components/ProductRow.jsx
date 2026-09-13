import { useStore, useCart } from '../store.jsx';
import { esc, fmtMoney, isPromo, promoOldPrice } from '../utils.js';
import { quantityError } from '../orderRules.js';

export default function ProductRow({ p }) {
  const { state } = useStore();
  const { cartDetail, setCartDetail } = useCart();
  const d = cartDetail(p.id);
  const q = state.cart[p.id] || 0;
  const promo = isPromo(p);
  const oldP = promo ? promoOldPrice(p) : null;
  const validationError = q > 0 ? quantityError(p, q) : '';

  function step(which, dir) {
    const cur = { lots: d.lots || 0, pcs: d.pcs || 0 };
    if (which === 'lots') cur.lots = dir === '+' ? cur.lots + 1 : Math.max(0, cur.lots - 1);
    else cur.pcs = dir === '+' ? cur.pcs + 1 : Math.max(0, cur.pcs - 1);
    setCartDetail(p, cur.lots, cur.pcs);
  }
  function onLotsInput(e) {
    const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
    setCartDetail(p, v, d.pcs || 0);
  }
  function onPcsInput(e) {
    const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
    setCartDetail(p, d.lots || 0, v);
  }

  return (
    <div className={'product' + (promo ? ' product--promo' : '') + (validationError ? ' product--invalid' : '')}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 600 }}>{esc(p.code)}</span>
          <span className="product__name">{esc(p.name)}</span>
          {promo ? <span className="promo-tag">Акция</span> : null}
        </div>
        <div style={{ fontSize: 12, color: 'var(--gray-600)', marginTop: 2 }}>
          {p.weight ? p.weight + ' кг · ' : ''}{p.shelf ? 'срок ' + esc(p.shelf) : ''}
          {p.lotOnly ? ' · только лотками по ' + p.piecesPerLot + ' шт' : (p.minOrder > 1 ? ' · мин. ' + p.minOrder + ' шт' : '')}
          {validationError ? <span className="product__validation" role="alert"> · {validationError}</span> : null}
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 120 }}>
        {oldP ? <div className="price-old">{fmtMoney(oldP)}</div> : null}
        <div className={'price' + (promo ? ' price--promo' : '')}>{fmtMoney(p.price)}</div>
        {p.discount > 0 ? <div className={'price-disc' + (promo ? ' price-disc--promo' : '')}>−{p.discount.toFixed(1)}%</div> : null}
        <div style={{ fontSize: 11, color: 'var(--gray-600)' }}>за {esc(p.unit)}</div>
      </div>
      <div className={'qty qty--lotonly' + (p.lotOnly ? ' qty--2col' : '')}>
        <div className="qty__field">
          <div className="qty__stepper">
            <button type="button" className="qty__btn" aria-label="−" onClick={() => step('lots', '-')}>−</button>
            <input type="text" inputMode="numeric" pattern="[0-9]*" value={d.lots || 0} onChange={onLotsInput} />
            <button type="button" className="qty__btn" aria-label="+" onClick={() => step('lots', '+')}>+</button>
          </div>
        </div>
        {p.lotOnly ? <div className="qty__field qty__field--empty" /> : (
          <div className="qty__field">
            <div className="qty__stepper">
              <button type="button" className="qty__btn" aria-label="−" onClick={() => step('pcs', '-')}>−</button>
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={d.pcs || 0} onChange={onPcsInput} />
              <button type="button" className="qty__btn" aria-label="+" onClick={() => step('pcs', '+')}>+</button>
            </div>
          </div>
        )}
        <div className="qty__field">
          <div className="qty__total">{q}</div>
        </div>
      </div>
    </div>
  );
}
