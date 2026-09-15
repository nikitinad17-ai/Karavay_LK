import { useStore, useAuth } from '../store';
import { esc } from '../utils';
import { IconDash, IconCart, IconOrders, IconOutlets, IconDocs, IconProfile, IconPhone } from '../icons';
import type { ComponentType, SVGProps } from 'react';
import type { Route } from '../types';

interface NavItem {
  route: Exclude<Route, 'login'>;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  badge?: boolean;
  buyerOnly?: boolean;
}

const NAV: NavItem[] = [
  { route: 'dashboard', label: 'Обзор', Icon: IconDash },
  { route: 'order', label: 'Оформить заказ', Icon: IconCart, badge: true },
  { route: 'orders', label: 'История заказов', Icon: IconOrders },
  { route: 'outlets', label: 'Мои точки', Icon: IconOutlets, buyerOnly: true },
  { route: 'documents', label: 'Документы', Icon: IconDocs },
  { route: 'profile', label: 'Профиль', Icon: IconProfile },
];

interface SidebarProps {
  blocked: boolean;
  menuOpen: boolean;
  onNavigate: (route: Route) => void;
  onCloseMenu: () => void;
}

export default function Sidebar({ blocked, menuOpen, onNavigate, onCloseMenu }: SidebarProps) {
  const { state } = useStore();
  const { logout } = useAuth();
  const b = state.buyer;
  const cartCount = Object.keys(state.cart).length;
  const isBuyerRole = state.role === 'buyer';

  return (
    <>
      <aside className={'sidebar' + (menuOpen ? ' open' : '')} id="sidebar" {...(blocked ? { inert: '' as unknown as boolean } : {})}>
        <a className="sidebar__logo" href="https://karavay.spb.ru" target="_blank" rel="noopener noreferrer" title="Перейти на сайт КАРАВАЙ">
          <img src={import.meta.env.BASE_URL + 'logo-official.svg'} alt="КАРАВАЙ" className="sidebar__logo-img" />
          <div className="sidebar__logo-text">
            <div className="sidebar__logo-title">КАРАВАЙ</div>
            <div className="sidebar__logo-sub">Личный кабинет</div>
          </div>
        </a>
        <ul className="sidebar__nav">
          {NAV.filter((n) => !n.buyerOnly || isBuyerRole).map((n) => (
            <li key={n.route}>
              <a
                data-route={n.route}
                className={state.route === n.route ? 'active' : ''}
                href="#"
                onClick={(e) => { e.preventDefault(); onNavigate(n.route); }}
              >
                <n.Icon />
                {n.label}
                {n.badge && cartCount > 0 ? <span className="badge">{cartCount}</span> : null}
              </a>
            </li>
          ))}
        </ul>
        <div className="sidebar__foot">
          <div className="sidebar__contact">
            <div className="sidebar__contact-title">Стол заказов</div>
            <div className="sidebar__contact-line"><IconPhone /> <span>Контакт будет подключён к рабочему API</span></div>
            <div className="sidebar__contact-line">Пн–Пт 8:00–18:00</div>
          </div>
          <div>Менеджер: <strong style={{ color: '#FFDD00' }}>{esc(b?.manager)}</strong></div>
          <div>{esc(b?.managerPhone)}</div>
          <button onClick={logout}>Выйти</button>
          <a className="sidebar__site-link" href="https://karavay.spb.ru" target="_blank" rel="noopener noreferrer">karavay.spb.ru</a>
        </div>
      </aside>
      <div className={'sidebar-overlay' + (menuOpen ? ' is-visible' : '')} id="sidebarOverlay" onClick={onCloseMenu} />
    </>
  );
}
