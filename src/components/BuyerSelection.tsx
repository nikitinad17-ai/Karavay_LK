import { useState } from 'react';
import { useAuth, useStore } from '../store';
import { esc } from '../utils';
import type { BuyerAccessRole } from '../types';

const ROLE_LABELS: Record<BuyerAccessRole, string> = {
  owner: 'Владелец доступа',
  manager: 'Менеджер',
  viewer: 'Просмотр',
};

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Не удалось открыть выбранное юрлицо.';
}

export default function BuyerSelection() {
  const { state } = useStore();
  const { selectBuyer, doLogout } = useAuth();
  const [loadingBuyerId, setLoadingBuyerId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const directory = state.userDirectory;

  if (!directory) return null;

  function choose(buyerId: string) {
    if (loadingBuyerId) return;
    setError('');
    setLoadingBuyerId(buyerId);
    selectBuyer(buyerId)
      .catch((value: unknown) => setError(messageOf(value)))
      .finally(() => setLoadingBuyerId(null));
  }

  return (
    <main className="buyer-select-page">
      <section className="buyer-select-card" aria-labelledby="buyerSelectTitle">
        <img src={import.meta.env.BASE_URL + 'logo-official.svg'} alt="КАРАВАЙ" className="buyer-select-logo" />
        <p className="buyer-select-eyebrow">Пользователь: {esc(directory.user.name)}</p>
        <h1 id="buyerSelectTitle">Выберите юридическое лицо</h1>
        <p className="buyer-select-lead">Вам доступно несколько покупателей. Получатели и данные кабинета загрузятся только после выбора.</p>
        {(error || state.buyerSwitchError) ? (
          <div className="login__error" role="alert">{error || state.buyerSwitchError}</div>
        ) : null}
        <div className="buyer-select-list">
          {directory.accesses.map(({ buyer, membership }) => (
            <button
              key={membership.id}
              type="button"
              className="buyer-select-option"
              disabled={Boolean(loadingBuyerId)}
              onClick={() => choose(membership.buyerId)}
            >
              <span className="buyer-select-option__name">{esc(buyer.name)}</span>
              <span className="buyer-select-option__meta">{esc(buyer.code)} · {ROLE_LABELS[membership.role]}</span>
              <span className="buyer-select-option__action">
                {loadingBuyerId === membership.buyerId ? 'Загружаем…' : 'Открыть кабинет'}
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--ghost buyer-select-logout" onClick={doLogout}>Выйти</button>
      </section>
    </main>
  );
}
