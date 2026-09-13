import { useState, useEffect } from 'react';
import { useLoaders, useOrderActions, useStore } from './store.jsx';
import { initials, esc } from './utils.js';
import Sidebar from './components/Sidebar.jsx';
import OutletBar from './components/OutletBar.jsx';
import Toast from './components/Toast.jsx';
import ConfirmModal from './components/ConfirmModal.jsx';
import Login from './components/Login.jsx';
import Dashboard from './components/Dashboard.jsx';
import OrderPage from './components/OrderPage.jsx';
import OrdersHistory from './components/OrdersHistory.jsx';
import OrderModal from './components/OrderModal.jsx';
import Outlets from './components/Outlets.jsx';
import Documents from './components/Documents.jsx';
import Profile from './components/Profile.jsx';
import MobileReview from './components/MobileReview.jsx';
import OrderReview from './components/OrderReview.jsx';
import { IconMenu } from './icons.jsx';

const TITLES = {
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
  const goto = (route) => {
    const wasOrder = state.route === 'order';
    const patchObj = { route };
    if (route === 'order' && !wasOrder) patchObj.orderReady = false;
    if (route !== 'order') patchObj.productSearch = '';
    patch(patchObj);
    setMenuOpen(false);
  };

  // ESC закрывает модалку заказа / confirm — как в оригинале (клавиатурная доступность)
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (state.confirm) { patch({ confirm: null }); return; }
      if (state.reviewOpen) { closeOrderReview(); return; }
      if (state.modalOrder) closeOrderModal();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.confirm, state.reviewOpen, state.modalOrder, patch, closeOrderModal, closeOrderReview]);

  if (!state.buyer || state.route === 'login') {
    return <Login />;
  }

  const b = state.buyer;
  const blockingOverlay = Boolean(state.reviewOpen || state.modalOrder || state.confirm);
  const isBuyerRole = state.role === 'buyer';
  const scopeLabel = isBuyerRole
    ? (state.outlets.length > 1 ? state.outlets.length + ' точки · доступ покупателя' : '1 точка · доступ покупателя')
    : 'Только эта точка · доступ получателя';

  let PageContent = null;
  switch (state.route) {
    case 'order': PageContent = <OrderPage />; break;
    case 'orders': PageContent = <OrdersHistory />; break;
    case 'outlets': PageContent = <Outlets goto={goto} />; break;
    case 'documents': PageContent = <Documents />; break;
    case 'profile': PageContent = <Profile goto={goto} />; break;
    default: PageContent = <Dashboard goto={goto} />;
  }

  return (
    <div className="app">
      <Sidebar blocked={blockingOverlay} menuOpen={menuOpen} onNavigate={goto} onCloseMenu={() => setMenuOpen(false)} />
      <div className="main" inert={blockingOverlay ? '' : undefined}>
        <div className="topbar">
          <button className="menu-toggle" aria-label="Меню" onClick={() => setMenuOpen((v) => !v)}>
            <IconMenu />
          </button>
          <h1 className="topbar__title">{TITLES[state.route] || ''}</h1>
          <div className="topbar__spacer" />
          <div className="topbar__user">
            <div className="avatar">{initials(b.name)}</div>
            <div>
              <div className="topbar__user-name">{esc(b.name)}</div>
              <div className="topbar__user-code">{esc(b.code)} · {scopeLabel}</div>
            </div>
          </div>
        </div>
        <div className={'content' + (state.route === 'order' ? ' content--wide' : '')}>
          <OutletBar />
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
