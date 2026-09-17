import { useStore, currentOutletOf, lastOrderForOutlet } from '../store';
import { esc, fmtMoney, fmtMoneyShort, fmtDateShort, shipmentModeLabel, plural } from '../utils';
import { ShipmentPill } from './Pills';
import RecipientRow from './RecipientRow';
import { IconOutlets } from '../icons';
import type { Role, Route } from '../types';
import { isPocketBaseDirectoryMode } from '../runtimeConfig';

function showsBalance(role: Role | null): boolean { return role === 'buyer'; }

export default function Profile({ goto }: { goto: (route: Route) => void }) {
  const { state } = useStore();
  const b = state.buyer;
  if (!b) return null;

  if (isPocketBaseDirectoryMode()) {
    const current = currentOutletOf(state);
    const accessRole = state.selectedBuyerContext?.membership.role;
    const accessRoleLabel = accessRole === 'owner' ? 'Владелец' : accessRole === 'manager' ? 'Менеджер' : 'Просмотр';
    return (
      <>
        <div className="grid grid-2">
          <div className="card">
            <h3 className="card__title">Пользователь и доступ</h3>
            <dl className="dl">
              <dt>Пользователь</dt><dd>{esc(state.authenticatedUser?.name)}</dd>
              <dt>Логин</dt><dd><strong>{esc(state.authenticatedUser?.login)}</strong></dd>
              <dt>Юрлицо</dt><dd>{esc(b.name)}</dd>
              <dt>Роль</dt><dd>{accessRoleLabel}</dd>
            </dl>
          </div>
          <div className="card">
            <h3 className="card__title">Выбранный покупатель</h3>
            <dl className="dl">
              <dt>Код КИС</dt><dd><strong>{esc(b.code)}</strong></dd>
              <dt>ID КИС</dt><dd>{b.Id_pay}</dd>
              <dt>Получателей</dt><dd>{state.outlets.length}</dd>
              <dt>Текущая точка</dt><dd>{current ? esc(current.name) : '—'}</dd>
            </dl>
          </div>
        </div>
        {state.outlets.length ? (
          <div className="card" style={{ marginTop: 20 }}>
            <h3 className="card__title">Связанные получатели</h3>
            <div className="recipient-list">
              {state.outlets.map((o) => (
                <RecipientRow key={o.id} o={o} minBuyer={0} lastOrder={null} />
              ))}
            </div>
          </div>
        ) : null}
        <div className="card" style={{ marginTop: 20 }}>
          <h3 className="card__title">Граница этапа</h3>
          <p style={{ margin: 0, color: 'var(--gray-600)', lineHeight: 1.6 }}>
            Пользователь, его связи, выбранный покупатель и получатели загружены из PocketBase. Договор, сальдо, цены, матрица, заказы и документы появятся только после подключения серверного API КИС.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="grid grid-2">
        <div className="card">
          <h3 className="card__title">Покупатель (плательщик)</h3>
          <dl className="dl">
            <dt>Наименование</dt><dd>{esc(b.legal || b.name)}</dd>
            <dt>Код покупателя</dt><dd><strong>{esc(b.code)}</strong></dd>
            <dt>ИНН</dt><dd>{esc(b.inn)}</dd>
            <dt>Email</dt><dd>{esc(b.email)}</dd>
            <dt>С нами с</dt><dd>{b.sinceYear} года</dd>
            <dt>Менеджер</dt><dd>{esc(b.manager)}<br /><span style={{ color: 'var(--gray-600)' }}>{esc(b.managerPhone)}</span></dd>
            <dt>Договор поставки</dt>
            <dd>
              {b.hasContract ? (
                <><span className="pill pill--ok">Действует</span> {esc(b.contractNumber || '')}{b.contractDate ? ' от ' + fmtDateShort(b.contractDate) : ''}</>
              ) : (
                <><span className="pill pill--stop">Нет</span> — свяжитесь с менеджером</>
              )}
            </dd>
          </dl>
        </div>

        {showsBalance(state.role) ? (
          <div className="card">
            <h3 className="card__title">Расчёты и отгрузка</h3>
            <dl className="dl">
              <dt>Сальдо</dt>
              <dd><strong style={{ color: (b.balance || 0) < 0 ? 'var(--danger)' : 'var(--blue-ink)' }}>{fmtMoney(b.balance || 0)}</strong></dd>
              <dt>Отсрочка платежа</dt><dd>{b.paymentDeferralDays} дней</dd>
              <dt>Правило отгрузки</dt><dd>{esc(shipmentModeLabel(b.shipmentMode))} · <ShipmentPill buyer={b} /></dd>
              {b.shipmentBlockReason ? <><dt>Причина</dt><dd style={{ color: 'var(--danger)' }}>{esc(b.shipmentBlockReason)}</dd></> : null}
              <dt>Мин. сумма (покупатель)</dt><dd>{fmtMoneyShort(b.minOrderSum || 0)}</dd>
            </dl>
            {b.badges && b.badges.length ? (
              <div style={{ marginTop: 8 }}>{b.badges.map((x) => <span key={x} className="badge-tag">{esc(x)}</span>)}</div>
            ) : null}
          </div>
        ) : (
          <div className="card">
            <h3 className="card__title">Отгрузка</h3>
            <dl className="dl">
              <dt>Правило</dt><dd>{esc(shipmentModeLabel(b.shipmentMode))} · <ShipmentPill buyer={b} /></dd>
              {b.shipmentBlockReason ? <><dt>Причина</dt><dd style={{ color: 'var(--danger)' }}>{esc(b.shipmentBlockReason)}</dd></> : null}
              <dt>Отсрочка платежа</dt><dd>{b.paymentDeferralDays} дней</dd>
              <dt>Мин. сумма (покупатель)</dt><dd>{fmtMoneyShort(b.minOrderSum || 0)}</dd>
            </dl>
            {b.badges && b.badges.length ? (
              <div style={{ marginTop: 8 }}>{b.badges.map((x) => <span key={x} className="badge-tag">{esc(x)}</span>)}</div>
            ) : null}
          </div>
        )}
      </div>

      {state.outlets && state.outlets.length ? (
        <div className="card" style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <h3 className="card__title" style={{ margin: 0 }}>
              {state.outlets.length > 1 ? 'Получатели' : 'Получатель'}
              {' '}<span style={{ color: 'var(--gray-600)', fontWeight: 400, fontSize: 14 }}>· {state.outlets.length} {plural(state.outlets.length, 'точка', 'точки', 'точек')}</span>
            </h3>
            {state.outlets.length > 1 ? (
              <button className="btn btn--ghost btn--sm" onClick={() => goto('outlets')}><IconOutlets />Подробнее</button>
            ) : null}
          </div>
          <div className="recipient-list">
            {state.outlets.map((o) => (
              <RecipientRow key={o.id} o={o} minBuyer={b.minOrderSum || 0} lastOrder={lastOrderForOutlet(state, o.id)} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 20 }}>
        <h3 className="card__title">Как это работает</h3>
        <p style={{ margin: 0, color: 'var(--gray-600)', lineHeight: 1.6 }}>
          В рабочем контуре доступ <strong>покупателя</strong> будет охватывать его точки, а доступ <strong>точки</strong> — только её данные.
          {' '}Все настройки (минимальная сумма, возможность отгрузки, маршрут доставки, договор) корректируются <strong>Караваем</strong>.
          {' '}По вопросам условий — свяжитесь с менеджером: <strong>{esc(b.manager)}</strong>, {esc(b.managerPhone)}.
        </p>
      </div>
    </>
  );
}
