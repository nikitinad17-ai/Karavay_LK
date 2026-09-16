import { useState, useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import { useStore, useAuth } from '../store';
import { getDeviceCode, api } from '../utils';
import { getPocketBaseSession } from '../authApi';
import { isMockAuthMode, isPocketBaseAuthMode } from '../runtimeConfig';
import type { DeviceClient } from '../types';
import type { DemoAccountGroups } from '../demoAccounts';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function Login() {
  const { state, patch } = useStore();
  const { login, restoreSession } = useAuth();
  const [code, setCode] = useState(state.prefillCode || '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [restoring, setRestoring] = useState(isPocketBaseAuthMode() && Boolean(getPocketBaseSession()));
  const [demoAccounts, setDemoAccounts] = useState<DemoAccountGroups | null>(null);
  const restoreStarted = useRef(false);

  useEffect(() => {
    if (import.meta.env.VITE_AUTH_MODE !== 'mock') return;
    let active = true;
    import('../demoAccounts').then(({ demoAccountGroups }) => {
      if (active) setDemoAccounts(demoAccountGroups);
    }).catch(() => {
      if (active) setError('Не удалось загрузить демонстрационные профили.');
    });
    return () => { active = false; };
  }, []);

  // При маунте — если устройство запомнено, подтягиваем данные доверенного клиента
  useEffect(() => {
    if (isPocketBaseAuthMode()) return;
    const saved = getDeviceCode();
    if (saved && !state.deviceClient) {
      api<DeviceClient>('/api/lookup?code=' + encodeURIComponent(saved)).then((info) => {
        patch({ deviceClient: info });
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restoring || restoreStarted.current) return;
    restoreStarted.current = true;
    restoreSession().catch((err: unknown) => {
      setError(errorMessage(err, 'Не удалось восстановить сессию. Войдите снова.'));
    }).finally(() => {
      setRestoring(false);
    });
  }, [restoring, restoreSession]);

  const trusted = isPocketBaseAuthMode() ? null : state.deviceClient;
  const trustedInitials = trusted
    ? String(trusted.name || '').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase()
    : '';

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || restoring) return;
    setError('');
    setSubmitting(true);
    const codeVal = trusted ? trusted.code : code;
    login(codeVal, password, isPocketBaseAuthMode() ? false : trusted ? true : remember)
      .catch((err: unknown) => setError(errorMessage(err, 'Неверный ' + (trusted ? 'пароль' : 'код или пароль') + '. Попробуйте ещё раз.')))
      .finally(() => setSubmitting(false));
  }

  function fillDemo(c: string) {
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
              <button className="login__submit" type="submit" disabled={submitting || restoring}>{restoring ? 'Проверяем сессию…' : submitting ? 'Входим…' : 'Войти'}</button>
              <button type="button" className="login__switch" onClick={() => patch({ deviceClient: null, prefillCode: '' })}>
                Это не я — войти по другому коду
              </button>
            </>
          ) : (
            <>
              <h2 className="login__title">Вход в кабинет</h2>
              <p className="login__sub">{isPocketBaseAuthMode() ? 'Введите код КИС и пароль учётной записи PocketBase.' : 'Введите код покупателя или код точки и пароль, которые вам выдал менеджер.'}</p>
              <div id="loginErr">{error && <div className="login__error">{error}</div>}</div>
              <div className="login__field">
                <label htmlFor="loginCode">Код покупателя или точки</label>
                <input
                  id="loginCode" type="text" placeholder="Например, A016 или M-1467-01" autoComplete="username"
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
              {!isPocketBaseAuthMode() ? (
                <label className="login__remember">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Запомнить меня на этом устройстве
                </label>
              ) : null}
              <button className="login__submit" type="submit" disabled={submitting || restoring}>{restoring ? 'Проверяем сессию…' : submitting ? 'Входим…' : 'Войти'}</button>
              {isMockAuthMode() && demoAccounts ? <div className="login__hint">
                <strong>Демо-профили:</strong> кликните по коду — профиль и одноразовый демонстрационный ключ подставятся в форму. Реальные пароли в репозитории не хранятся.
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-600)' }}>Клиенты на ЭДО (заказывают и через личный кабинет):</div>
                <div className="login__demos">
                  {demoAccounts.edi.map((d) => (
                    <button key={d.code} type="button" className="login__demo login__demo--edi" onClick={() => fillDemo(d.code)}>{d.label}</button>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-600)' }}>Остальные клиенты:</div>
                <div className="login__demos">
                  {demoAccounts.buyers.map((d) => (
                    <button key={d.code} type="button" className="login__demo" onClick={() => fillDemo(d.code)}>{d.label}</button>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-600)' }}>Демо точек-получателей (видят только свою точку, без сальдо):</div>
                <div className="login__demos">
                  {demoAccounts.outlets.map((d) => (
                    <button key={d.code} type="button" className="login__demo" onClick={() => fillDemo(d.code)}>{d.label}</button>
                  ))}
                </div>
              </div> : null}
            </>
          )}
        </form>
      </div>
    </div>
  );
}
