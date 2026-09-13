import { useStore } from '../store.jsx';
import { esc } from '../utils.js';
import { IconCheck } from '../icons.jsx';

function matchTypeOnly(p, f) {
  if (f === 'in-cart') return false; // считаем ниже отдельно через state.cart
  return true;
}

export function categories(products) {
  const cats = {};
  products.forEach((p) => {
    if (!cats[p.category]) cats[p.category] = { name: p.category, order: p.categoryOrder, count: 0 };
    cats[p.category].count++;
  });
  return Object.keys(cats).map((k) => cats[k]).sort((a, c) => a.order - c.order || a.name.localeCompare(c.name, 'ru'));
}

export function matchType(p, f, cart) {
  if (f === 'in-cart') return !!cart[p.id];
  if (f === 'promo') return !!p.isPromo;
  return true;
}
export function matchSearch(p, q) {
  if (!q) return true;
  return p.name.toLowerCase().indexOf(q) >= 0 || String(p.code).indexOf(q) >= 0;
}
export function matchCats(p, selectedCats) {
  return !selectedCats.length || selectedCats.indexOf(p.category) >= 0;
}

export default function CategoryChips({ q }) {
  const { state, patch } = useStore();
  const byCat = state.products.filter((p) => matchType(p, state.filter, state.cart) && matchSearch(p, q));
  const catCounts = {};
  byCat.forEach((p) => { catCounts[p.category] = (catCounts[p.category] || 0) + 1; });
  // ТЗ ver.3: порядок категорий — по числовому префиксу MarketingGroup, не по количеству
  const allCats = categories(state.products).map((c) => c.name);
  const picked = state.categories.length;

  function toggleCat(name, checked) {
    const allNames = categories(state.products).map((c) => c.name);
    let cats = state.categories;
    // пустой state.categories означает «неявно выбрано всё»; при первом снятии
    // галочки материализуем полный список минус то, что сняли
    if (!cats.length && !checked) cats = allNames.slice();
    else cats = cats.slice();
    const idx = cats.indexOf(name);
    if (checked && idx < 0) cats.push(name);
    if (!checked && idx >= 0) cats.splice(idx, 1);
    // если в итоге отмечены все — возвращаемся к неявному «всё» (пустой массив)
    if (cats.length === allNames.length) cats = [];
    patch({ categories: cats });
  }

  return (
    <div className="cat-chips">
      <button type="button" className={'cat-chip cat-chip--all' + (picked ? '' : ' is-active')} onClick={() => patch({ categories: [] })}>
        Все
      </button>
      {allCats.map((name) => {
        const on = !picked || state.categories.indexOf(name) >= 0;
        const n = catCounts[name] || 0;
        return (
          <label key={name} className={'cat-chip' + (on ? ' is-active' : '') + (n ? '' : ' is-empty')}>
            <input type="checkbox" checked={on} onChange={(e) => toggleCat(name, e.target.checked)} />
            <span>{esc(name)}</span>
            {on ? <span className="cat-chip__check"><IconCheck /></span> : null}
          </label>
        );
      })}
    </div>
  );
}
