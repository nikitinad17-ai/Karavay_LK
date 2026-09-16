import type { Route } from '../types';

const LABELS: Partial<Record<Route, string>> = {
  order: 'Оформление заказа',
  orders: 'История заказов',
  documents: 'Документы',
};

export default function BusinessDataPending({ section }: { section: Route }) {
  return (
    <div className="card">
      <h3 className="card__title">{LABELS[section] || 'Бизнес-данные'}</h3>
      <div className="empty">
        Этот раздел откроется после подключения серверного API КИС. Сейчас проверяем только вход,
        восстановление сессии и права доступа к связке «покупатель → получатели» в PocketBase.
      </div>
    </div>
  );
}
