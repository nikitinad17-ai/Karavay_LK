import { useState, useEffect } from 'react';
import { currentOutletOf, useLoaders, useOrderActions, useStore } from './store';
import { initials, esc } from './utils';
import Sidebar from './components/Sidebar';
import OutletBar from './components/OutletBar';
import Toast from './components/Toast';
import ConfirmModal from './components/ConfirmModal';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import OrderPage from './components/OrderPage';
import OrdersHistory from './components/OrdersHistory';
import OrderModal from './components/OrderModal';
import Outlets from './components/Outlets';
import Documents from './components/Documents';
import Profile from './components/Profile';
import MobileReview from './components/MobileReview';
import OrderReview from './components/OrderReview';
import BusinessDataPending from './components/BusinessDataPending';
import BuyerSelection from './components/BuyerSelection';
import BuyerSwitcher from './components/BuyerSwitcher';
import { IconMenu } from './icons';
import type { Route, StatePatch } from './types';
import { isPocketBaseDirectoryMode } from './runtimeConfig';

const TITLES: Partial<Record<Route, string>> = {
  dashboard: 'Обзор',
  order: 'Оформить заказ',
  orders: 'История заказов',
  documents: 'Документы',
  profile: 'Профиль покупателя',
  outlets: 'Мои точки (получатели)',
};

export default function App() {
  const { state, patch } = useStore();
  const { loadBuyerData } = useLoaders();
  const { closeOrderModal, closeOrderReview } = useOrderActions();
  const [menuOpen, setMenuOpen] = useState(false);

  // Закрывать мобильное меню при смене раздела
  const goto = (route: Route) => {
    const wasOrder = state.route === 'order';
    const patchObj: StatePatch = { route };
    if (route === 'order' && !wasOrder) patchObj.orderReady = false;
    if (route !== 'order') patchObj.productSearch = '';
    patch(patchObj);
    setMenuOpen(false);
  };

  // ESC закрывает модалку заказа / confirm — как в оригинале (клавиатурная доступность)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (state.confirm) { patch({ confirm: null }); return; }
      if (state.reviewOpen) { closeOrderReview(); return; }
      if (state.modalOrder) closeOrderModal();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.confirm, state.reviewOpen, state.modalOrder, patch, closeOrderModal, closeOrderReview]);

  if (state.authenticatedUser && state.buyerSwitching) {
    return (
      <main className="buyer-select-page" aria-busy="true">
        <section className="buyer-select-card buyer-select-card--loading">
          <img src={import.meta.env.BASE_URL + 'logo-official.svg'} alt="КАРАВАЙ" className="buyer-select-logo" />
          <h1>Загружаем юрлицо…</h1>
          <p className="buyer-select-lead">Проверяем доступ и получателей в PocketBase.</p>
        </section>
      </main>
    );
  }

  if (state.authenticatedUser && (state.buyerSelectionRequired || state.route === 'buyer-select')) {
    return <BuyerSelection />;
  }

  if (!state.buyer || state.route === 'login') {
    return <Login />;
  }

  const b = state.buyer;
  const directoryMode = isPocketBaseDirectoryMode();
  const signedInOutlet = state.role === 'outlet' ? currentOutletOf(state) : null;
  const identityName = state.authenticatedUser?.name || signedInOutlet?.name || b.name;
  const identityCode = state.authenticatedUser?.login || signedInOutlet?.code || b.code;
  const blockingOverlay = Boolean(state.reviewOpen || state.modalOrder || state.confirm);
  const isBuyerRole = state.role === 'buyer';
  const accessRole = state.selectedBuyerContext?.membership.role;
  const accessRoleLabel = accessRole === 'owner' ? 'владелец' : accessRole === 'manager' ? 'менеджер' : accessRole === 'viewer' ? 'просмотр' : 'доступ покупателя';
  const scopeLabel = isBuyerRole
    ? (state.outlets.length === 0
      ? `нет получателей · ${accessRoleLabel}`
      : state.outlets.length > 1 ? `${state.outlets.length} точки · ${accessRoleLabel}` : `1 точка · ${accessRoleLabel}`)
    : 'Только эта точка · доступ получателя';

  let PageContent = null;
  switch (state.route) {
    case 'order': PageContent = directoryMode ? <BusinessDataPending section="order" /> : <OrderPage />; break;
    case 'orders': PageContent = directoryMode ? <BusinessDataPending section="orders" /> : <OrdersHistory />; break;
    case 'outlets': PageContent = <Outlets />; break;
    case 'documents': PageContent = directoryMode ? <BusinessDataPending section="documents" /> : <Documents />; break;
    case 'profile': PageContent = <Profile goto={goto} />; break;
    default: PageContent = <Dashboard goto={goto} />;
  }

  return (
    <div className="app">
      <Sidebar blocked={blockingOverlay} menuOpen={menuOpen} onNavigate={goto} onCloseMenu={() => setMenuOpen(false)} />
      <div className="main" {...(blockingOverlay ? { inert: '' as unknown as boolean } : {})}>
        <div className="topbar">
          <button className="menu-toggle" aria-label="Меню" onClick={() => setMenuOpen((v) => !v)}>
            <IconMenu />
          </button>
          <h1 className="topbar__title">{TITLES[state.route] || ''}</h1>
          <div className="topbar__spacer" />
          <BuyerSwitcher />
          <div className="topbar__user">
            <div className="avatar">{initials(identityName)}</div>
            <div>
              <div className="topbar__user-name">{esc(identityName)}</div>
              <div className="topbar__user-code">{esc(identityCode)} · {scopeLabel}</div>
            </div>
          </div>
        </div>
        <div className={'content' + (state.route === 'order' ? ' content--wide' : '')}>
          <OutletBar />
          {directoryMode ? (
            <div className="banner banner--info" role="status">
              <div><strong>PocketBase подключён.</strong> Пользователь, доступное юрлицо и его получатели загружены из базы. Заказы, матрица и документы подключим отдельным серверным API КИС.</div>
            </div>
          ) : null}
          {state.initialLoadError ? (
            <div className="banner banner--danger load-error" role="alert">
              <div><strong>Данные кабинета не загрузились.</strong> {state.initialLoadError}</div>
              <button type="button" className="btn btn--secondary btn--sm" onClick={loadBuyerData}>Повторить</button>
            </div>
          ) : null}
          {PageContent}
        </div>
      </div>
      <MobileReview />
      {state.modalOrder ? <OrderModal /> : null}
      {state.reviewOpen ? <OrderReview /> : null}
      <ConfirmModal />
      <Toast />
    </div>
  );
}
