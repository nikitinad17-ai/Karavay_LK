import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  AuthError, SELECTED_BUYER_KEY, SESSION_KEY, clearPocketBaseSession, getPocketBaseSession,
  getSelectedBuyerId, loginWithPocketBase, refreshPocketBaseSession, saveSelectedBuyerId,
} from '../src/authApi';
import type { StorageLike } from '../src/authApi';
import { resolveRuntimeConfig } from '../src/runtimeConfig';

const config = resolveRuntimeConfig({
  VITE_AUTH_MODE: 'pocketbase',
  VITE_DATA_MODE: 'directory',
  VITE_POCKETBASE_URL: 'http://pb.test:8090/',
});

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}

const activeUserRecord = {
  id: 'userrecord00001',
  login: 'ivan.petrov',
  name: 'Иван Петров',
  active: true,
  must_change_password: false,
};

test('режимы по умолчанию не включают mock в production-сборке', () => {
  const resolved = resolveRuntimeConfig({});
  assert.equal(resolved.authMode, 'pocketbase');
  assert.equal(resolved.dataMode, 'remote');
  assert.equal(resolved.usersCollection, 'users');
  assert.equal(resolved.userBuyersCollection, 'user_buyers');
});

test('пользователь входит только через users и сессия сохраняется без пароля и полного профиля', async () => {
  const storage = memoryStorage();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await loginWithPocketBase('ivan.petrov', 'entered-only-here', {
    config,
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url: requestUrl(url), init });
      return jsonResponse({ token: 'user-token', record: activeUserRecord });
    },
  });

  assert.equal(result.user.login, 'ivan.petrov');
  assert.equal(result.session.collection, 'users');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/users\/auth-with-password$/);
  assert.doesNotMatch(calls[0].url, /\/buyers\/|\/outlets\//);
  assert.equal(getPocketBaseSession(storage)?.token, 'user-token');
  assert.equal(storage.getItem(SESSION_KEY)?.includes('entered-only-here'), false);
  assert.equal(storage.getItem(SESSION_KEY)?.includes('Иван Петров'), false);
  assert.match(new Headers(calls[0].init?.headers).get('X-Request-ID') || '', /^.+$/);
});

test('неверные данные не запускают перебор buyers или outlets', async () => {
  const urls: string[] = [];
  await assert.rejects(
    loginWithPocketBase('unknown', 'wrong', {
      config,
      storage: memoryStorage(),
      fetchImpl: async (url) => {
        urls.push(requestUrl(url));
        return jsonResponse({ message: 'Failed to authenticate.' }, 400);
      },
    }),
    (error: unknown) => error instanceof AuthError
      && error.code === 'INVALID_CREDENTIALS'
      && error.message === 'Неверный логин или пароль.',
  );
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/users\/auth-with-password$/);
});

test('неактивный пользователь не входит', async () => {
  await assert.rejects(
    loginWithPocketBase('ivan.petrov', 'input', {
      config,
      storage: memoryStorage(),
      fetchImpl: async () => jsonResponse({ token: 'token', record: { ...activeUserRecord, active: false } }),
    }),
    (error: unknown) => error instanceof AuthError && error.code === 'ACCOUNT_DISABLED' && error.status === 403,
  );
});

test('пользователь с временным паролем не входит', async () => {
  await assert.rejects(
    loginWithPocketBase('ivan.petrov', 'temporary-input', {
      config,
      storage: memoryStorage(),
      fetchImpl: async () => jsonResponse({
        token: 'token',
        record: { ...activeUserRecord, must_change_password: true },
      }),
    }),
    (error: unknown) => error instanceof AuthError && error.code === 'PASSWORD_CHANGE_REQUIRED' && error.status === 403,
  );
});

test('некорректная схема пользователя блокирует вход fail-closed', async () => {
  const { active: _removed, ...withoutActive } = activeUserRecord;
  await assert.rejects(
    loginWithPocketBase('ivan.petrov', 'input', {
      config,
      storage: memoryStorage(),
      fetchImpl: async () => jsonResponse({ token: 'token', record: withoutActive }),
    }),
    (error: unknown) => error instanceof AuthError && error.code === 'INVALID_USER_SCHEMA',
  );
});

test('auth-refresh проверяет users, пользователя и обновляет токен', async () => {
  const storage = memoryStorage();
  storage.setItem(SESSION_KEY, JSON.stringify({
    token: 'old-token', collection: 'users', userId: activeUserRecord.id, login: activeUserRecord.login,
  }));
  saveSelectedBuyerId('buyerrecord001', storage);
  let authorization = '';
  const refreshed = await refreshPocketBaseSession({
    config,
    storage,
    fetchImpl: async (url, init) => {
      assert.match(requestUrl(url), /\/users\/auth-refresh$/);
      authorization = new Headers(init?.headers).get('Authorization') || '';
      return jsonResponse({ token: 'new-token', record: activeUserRecord });
    },
  });

  assert.equal(authorization, 'old-token');
  assert.equal(refreshed?.session.token, 'new-token');
  assert.equal(refreshed?.user.id, activeUserRecord.id);
  assert.equal(getSelectedBuyerId(storage), 'buyerrecord001');
});

test('refresh другого пользователя завершает сессию', async () => {
  const storage = memoryStorage();
  storage.setItem(SESSION_KEY, JSON.stringify({
    token: 'old-token', collection: 'users', userId: activeUserRecord.id, login: activeUserRecord.login,
  }));
  await assert.rejects(
    refreshPocketBaseSession({
      config,
      storage,
      fetchImpl: async () => jsonResponse({
        token: 'new-token',
        record: { ...activeUserRecord, id: 'otheruser000001' },
      }),
    }),
    (error: unknown) => error instanceof AuthError && error.code === 'SESSION_USER_MISMATCH',
  );
  assert.equal(getPocketBaseSession(storage), null);
});

test('выход очищает токен и выбранного покупателя', () => {
  const storage = memoryStorage();
  storage.setItem(SESSION_KEY, JSON.stringify({
    token: 'token', collection: 'users', userId: activeUserRecord.id, login: activeUserRecord.login,
  }));
  storage.setItem(SELECTED_BUYER_KEY, 'buyerrecord001');
  clearPocketBaseSession(storage);
  assert.equal(getPocketBaseSession(storage), null);
  assert.equal(getSelectedBuyerId(storage), null);
});

test('сетевая ошибка не маскируется под неверный пароль', async () => {
  await assert.rejects(
    loginWithPocketBase('ivan.petrov', 'input', {
      config,
      storage: memoryStorage(),
      fetchImpl: async () => { throw new Error('offline'); },
    }),
    (error: unknown) => error instanceof AuthError && error.code === 'NETWORK' && /недоступен/.test(error.message),
  );
});

test('конфигурация отклоняет небезопасную схему URL и пустые коллекции', () => {
  assert.throws(() => resolveRuntimeConfig({ VITE_POCKETBASE_URL: 'file:///tmp/pb' }), /http или https/);
  assert.throws(() => resolveRuntimeConfig({ VITE_AUTH_TIMEOUT_MS: '500' }), /не меньше 1000/);
  assert.throws(() => resolveRuntimeConfig({ VITE_POCKETBASE_USERS_COLLECTION: ' ' }), /не могут быть пустыми/);
});
