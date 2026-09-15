import { useStore, useToast } from '../store';
import { esc, fmtDate } from '../utils';
import { IconDownload } from '../icons';

const KINDS: Record<string, string> = {
  contract: 'Договор',
  invoice: 'Счёт-фактура',
  act: 'Акт',
  pricelist: 'Прайс-лист',
  declaration: 'Декларации соответствия',
};
const KIND_ICONS: Record<string, string> = { contract: '📄', invoice: '🧾', act: '📋', pricelist: '💰', declaration: '📜' };

export default function Documents() {
  const { state } = useStore();
  const toast = useToast();

  return (
    <div className="card">
      <h3 className="card__title">Все документы</h3>
      <ul className="doclist">
        {state.documents.map((d) => {
          const hasHref = d.href && d.href !== '#';
          return (
            <li key={d.id}>
              <div className="doclist__icon" style={{ fontSize: 20 }}>{KIND_ICONS[d.kind] || '📄'}</div>
              <div className="doclist__info">
                <div className="doclist__title">{esc(d.title)}</div>
                <div className="doclist__meta">
                  {esc(KINDS[d.kind] || 'Документ')} · {esc(d.number)} · {fmtDate(d.date)}{d.orderId ? ' · к заказу №' + d.orderId : ''}
                </div>
              </div>
              {hasHref ? (
                <a className="btn btn--secondary btn--sm" href={d.href} target="_blank" rel="noopener noreferrer"><IconDownload />Открыть PDF</a>
              ) : (
                <button className="btn btn--secondary btn--sm" onClick={() => toast('Демо: документ будет скачан в реальной системе.')}>
                  <IconDownload />Скачать
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
