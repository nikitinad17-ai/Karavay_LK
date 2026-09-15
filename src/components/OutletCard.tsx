import { esc, fmtMoneyShort } from '../utils';
import { IconPhone } from '../icons';
import type { Outlet } from '../types';

export default function OutletCard({ o, minBuyer }: { o: Outlet; minBuyer: number }) {
  const minSum = o.minOrderSum != null ? o.minOrderSum : minBuyer;
  return (
    <div className="card outlet-card">
      <div className="outlet-card__head">
        <div>
          <div className="outlet-card__code">{esc(o.code)}</div>
          <div className="outlet-card__name">{esc(o.name)}</div>
          <div className="outlet-card__addr">{esc(o.address)}</div>
        </div>
      </div>
      <div className="outlet-card__grid">
        <div>
          <div className="outlet-card__label">Торговый представитель</div>
          <div className="outlet-card__val">{esc(o.rep || '—')}</div>
          <div className="outlet-card__sub">{esc(o.repPhone || '')}</div>
        </div>
        <div>
          <div className="outlet-card__label">Телефон точки</div>
          <div className="outlet-card__val">
            {o.phones && o.phones.length
              ? o.phones.map((ph, i) => (
                  <span key={i}>{i > 0 ? <br /> : null}<IconPhone /> <a href={'tel:' + ph.replace(/[^\d+]/g, '')}>{ph}</a></span>
                ))
              : '—'}
          </div>
        </div>
        <div>
          <div className="outlet-card__label">Приёмщик товара</div>
          <div className="outlet-card__val">{esc(o.receiver || '—')}</div>
        </div>
        <div>
          <div className="outlet-card__label">Диспетчерская · {esc(o.dispatchPlatformName || '—')}</div>
          <div className="outlet-card__val">
            {o.dispatchPhone ? <a href={'tel:' + o.dispatchPhone.replace(/[^\d+]/g, '')}>{o.dispatchPhone}</a> : '—'}
          </div>
        </div>
        <div>
          <div className="outlet-card__label">Минимальная сумма заказа</div>
          <div className="outlet-card__val">{fmtMoneyShort(minSum)}</div>
        </div>
      </div>
    </div>
  );
}
