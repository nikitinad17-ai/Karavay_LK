import { useStore } from '../store.jsx';
import { esc, fmtDateShort } from '../utils.js';
import { IconChevron } from '../icons.jsx';
import OutletCard from './OutletCard.jsx';

export default function RecipientRow({ o, minBuyer, lastOrder }) {
  const { state, patch } = useStore();
  const isCurrent = o.id === state.currentOutletId;
  const isOpen = state.profileOutletId === o.id;

  return (
    <>
      <div
        className={'recipient-row' + (isCurrent ? ' recipient-row--current' : '') + (isOpen ? ' recipient-row--open' : '')}
        role="button" tabIndex={0}
        onClick={() => patch({ profileOutletId: isOpen ? null : o.id })}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); patch({ profileOutletId: isOpen ? null : o.id }); } }}
      >
        <div className="recipient-row__main">
          <div className="recipient-row__name">{esc(o.name)} <span className="recipient-row__code">{esc(o.code)}</span></div>
          <div className="recipient-row__addr">{esc(o.address || '')}</div>
        </div>
        <div className="recipient-row__last">
          <div className="recipient-row__label">Последний заказ</div>
          {lastOrder ? (
            <>
              <div className="recipient-row__date">№{lastOrder.orderNumber} · {fmtDateShort(lastOrder.deliveryDate)}</div>
              <div><span className={'pill pill--' + lastOrder.pill}>{lastOrder.state}</span></div>
            </>
          ) : (
            <div className="recipient-row__none">Заказов ещё не было</div>
          )}
        </div>
        <div className={'recipient-row__go recipient-row__go--' + (isOpen ? 'open' : 'closed')}><IconChevron /></div>
      </div>
      {isOpen ? <div className="recipient-detail"><OutletCard o={o} minBuyer={minBuyer} /></div> : null}
    </>
  );
}
