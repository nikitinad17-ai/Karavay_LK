import { useStore, lastOrderForOutlet } from '../store';
import { esc, plural } from '../utils';
import RecipientRow from './RecipientRow';

export default function Outlets() {
  const { state } = useStore();
  const b = state.buyer;
  if (!b) return null;
  const minBuyer = b.minOrderSum || 0;

  return (
    <>
      <div className="banner banner--info">
        <strong>Настройки точки (минимальная сумма, возможность отгрузки, маршрут доставки) корректируются Караваем.</strong>
        {' '}Для изменений свяжитесь с вашим менеджером: <strong>{esc(b.manager || '—')}</strong>, {esc(b.managerPhone || '')}.
      </div>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <h3 className="card__title" style={{ margin: 0 }}>
            {state.outlets.length > 1 ? 'Получатели' : 'Получатель'}
            {' '}<span style={{ color: 'var(--gray-600)', fontWeight: 400, fontSize: 14 }}>· {state.outlets.length} {plural(state.outlets.length, 'точка', 'точки', 'точек')}</span>
          </h3>
        </div>
        <div className="recipient-list">
          {state.outlets.map((o) => (
            <RecipientRow key={o.id} o={o} minBuyer={minBuyer} lastOrder={lastOrderForOutlet(state, o.id)} />
          ))}
        </div>
      </div>
    </>
  );
}
