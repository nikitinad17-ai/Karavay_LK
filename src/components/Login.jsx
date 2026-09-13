import { useState, useEffect } from 'react';
import { useStore, useAuth } from '../store.jsx';
import { getDeviceCode, api } from '../utils.js';

const DEMO_EDI = [
  { code: 'DEMO-B-15', label: 'DEMO-B-15 · Демо-покупатель EDI', edi: true },
  { code: 'DEMO-B-16', label: 'DEMO-B-16 · Демо-покупатель EDI', edi: true },
];
const DEMO_OTHER = Array.from({ length: 14 }, (_, index) => {
  const id = index + 1;
  const code = `DEMO-B-${String(id).padStart(2, '0')}`;
  const state = id === 2 ? ' · отрицательное сальдо' : id === 4 ? ' · без договора' : id === 8 ? ' · отгрузка запрещена' : '';
  return { code, label: `${code} · Демо-покупатель ${String(id).padStart(2, '0')}${state}` };
});
const DEMO_OUTLETS = [
  { code: 'DEMO-O-0101', label: 'DEMO-O-0101 · Демо-точка 0101' },
  { code: 'DEMO-O-1101', label: 'DEMO-O-1101 · Демо-точка 1101' },
];

export default function Login() {
  const { state, patch } = useStore();
  const { login } = useAuth();
  const [code, setCode] = useState(state.prefillCode || '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');

  // При маунте — если устройство запомнено, подтягиваем данные доверенного клиента
  useEffect(() => {
    const saved = getDeviceCode();
    if (saved && !state.deviceClient) {
      api('/api/lookup?code=' + encodeURIComponent(saved)).then((info) => {
        patch({ deviceClient: info });
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trusted = state.deviceClient;
  const trustedInitials = trusted
    ? String(trusted.name || '').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase()
    : '';

  function submit(e) {
    e.preventDefault();
    setError('');
    const codeVal = trusted ? trusted.code : code;
    login(codeVal, password, trusted ? true : remember).catch(() => {
      setError('Неверный ' + (trusted ? 'пароль' : 'код или пароль') + '. Попробуйте ещё раз.');
    });
  }

  function fillDemo(c) {
    setCode(c);
    setPassword(crypto.randomUUID());
  }

  return (
    <div className="login">
      <div className="login__hero">
        <div className="login__hero-inner">
          <div className="login__logo-circle" style={{ marginBottom: 32 }}>
            <img src={import.meta.env.BASE_URL + 'logo-official.svg'} alt="КАРАВАЙ" width="150" height="150" />
          </div>
          <h1 className="login__slogan">Всё будет<br /><span className="accent">хорошо!</span></h1>
          <p className="login__lead">
            Личный кабинет покупателя ОАО «КАРАВАЙ».<br />
            Заказы, документы, связь с вашим менеджером — <span className="nowrap">в одном месте</span>.
          </p>
          <a className="login__site-link login__site-link--bottom" href="https://karavay.spb.ru" target="_blank" rel="noopener noreferrer">
            karavay.spb.ru
          </a>
        </div>
      </div>
      <div className="login__form-side">
        <form className="login__form-card" onSubmit={submit}>
          {trusted ? (
            <>
              <div className="login__trusted">
                <div className="login__trusted-avatar">{trustedInitials}</div>
                <div className="login__trusted-name">{trusted.name}</div>
                <div className="login__trusted-code">Код: <strong>{trusted.code}</strong> · устройство запомнено</div>
              </div>
              <div id="loginErr">{error && <div className="login__error">{error}</div>}</div>
              <div className="login__field">
                <label htmlFor="loginPass">Пароль</label>
                <input
                  id="loginPass" type="password" placeholder="Ваш пароль" autoComplete="current-password"
                  autoFocus required value={password} onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button className="login__submit" type="submit">Войти</button>
              <button type="button" className="login__switch" onClick={() => patch({ deviceClient: null, prefillCode: '' })}>
                Это не я — войти по другому коду
              </button>
            </>
          ) : (
            <>
              <h2 className="login__title">Вход в кабинет</h2>
              <p className="login__sub">Введите код покупателя или код точки и пароль, которые вам выдал менеджер.</p>
              <div id="loginErr">{error && <div className="login__error">{error}</div>}</div>
              <div className="login__field">
                <label htmlFor="loginCode">Код покупателя или точки</label>
                <input
                  id="loginCode" type="text" placeholder="DEMO-B-01 или DEMO-O-0101" autoComplete="username"
                  required value={code} onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <div className="login__field">
                <label htmlFor="loginPass">Пароль</label>
                <input
                  id="loginPass" type="password" placeholder="Ваш пароль" autoComplete="current-password"
                  required value={password} onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <label className="login__remember">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Запомнить меня на этом устройстве
              </label>
              <button className="login__submit" type="submit">Войти</button>
              <div className="login__hint">
                <strong>Демо-профили:</strong> кликните по коду — профиль и одноразовый демонстрационный ключ подставятся в форму. Реальные пароли в репозитории не хранятся.
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-600)' }}>Клиенты на ЭДО (заказывают и через личный кабинет):</div>
                <div className="login__demos">
                  {DEMO_EDI.map((d) => (
                    <button key={d.code} type="button" className="login__demo login__demo--edi" onClick={() => fillDemo(d.code)}>{d.label}</button>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-600)' }}>Остальные клиенты:</div>
                <div className="login__demos">
                  {DEMO_OTHER.map((d) => (
                    <button key={d.code} type="button" className="login__demo" onClick={() => fillDemo(d.code)}>{d.label}</button>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-600)' }}>Демо точек-получателей (видят только свою точку, без сальдо):</div>
                <div className="login__demos">
                  {DEMO_OUTLETS.map((d) => (
                    <button key={d.code} type="button" className="login__demo" onClick={() => fillDemo(d.code)}>{d.label}</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
