import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  AuthError, SESSION_KEY, clearPocketBaseSession, getPocketBaseSession,
  loginWithPocketBase, refreshPocketBaseSession,
} from '../src/authApi';
import type { StorageLike } from '../src/authApi';
import { resolveRuntimeConfig } from '../src/runtimeConfig';

const config = resolveRuntimeConfig({
  VITE_AUTH_MODE: 'pocketbase',
  VITE_DATA_MODE: 'mock',
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

test('режимы по умолчанию не включают mock в production-сборке', () => {
  const resolved = resolveRuntimeConfig({});
  assert.equal(resolved.authMode, 'pocketbase');
  assert.equal(resolved.dataMode, 'remote');
});

test('покупатель входит через buyers и сессия сохраняется без пароля', async () => {
  const storage = memoryStorage();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await loginWithPocketBase('DEMO-B-01', 'entered-only-here', {
    config, storage,
    fetchImpl: async (url, init) => {
      calls.push({ url: requestUrl(url), init });
      return jsonResponse({ token: 'buyer-token', record: { id: 'buyer-1', kis_code: 'DEMO-B-01', active: true } });
    },
  });

  assert.equal(result.session.role, 'buyer');
  assert.equal(result.record.id, 'buyer-1');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/buyers\/auth-with-password$/);
  assert.equal(getPocketBaseSession(storage)?.token, 'buyer-token');
  assert.equal(storage.getItem(SESSION_KEY)?.includes('entered-only-here'), false);
  assert.equal(storage.getItem(SESSION_KEY)?.includes('buyer-1'), false);
  assert.match(new Headers(calls[0].init?.headers).get('X-Request-ID') || '', /^.+$/);
});

test('после отказа buyers точка входит через outlets', async () => {
  const storage = memoryStorage();
  const urls: string[] = [];
  const result = await loginWithPocketBase('DEMO-O-0101', 'temporary-input', {
    config, storage,
    fetchImpl: async (url) => {
      const value = requestUrl(url);
      urls.push(value);
      if (value.includes('/buyers/')) return jsonResponse({ message: 'Failed to authenticate.' }, 400);
      return jsonResponse({ token: 'outlet-token', record: { id: 'outlet-1', kis_code: 'DEMO-O-0101', active: true } });
    },
  });

  assert.equal(result.session.role, 'outlet');
  assert.equal(urls.length, 2);
  assert.match(urls[1], /\/outlets\/auth-with-password$/);
});

test('одинаковый отказ обеих коллекций превращается в понятную ошибку', async () => {
  await assert.rejects(
    loginWithPocketBase('UNKNOWN', 'wrong', {
      config,
      storage: memoryStorage(),
      fetchImpl: async () => jsonResponse({ message: 'Failed to authenticate.' }, 400),
    }),
    (error: unknown) => error instanceof AuthError && error.code === 'INVALID_CREDENTIALS' && error.message === 'Неверный код или пароль.',
  );
});

test('отключённая запись не попадает в приложение', async () => {
  await assert.rejects(
    loginWithPocketBase('DEMO-B-01', 'input', {
      config,
      storage: memoryStorage(),
      fetchImpl: async () => jsonResponse({ token: 'token', record: { kis_code: 'DEMO-B-01', active: false } }),
    }),
    (error: unknown) => error instanceof AuthError && error.code === 'ACCOUNT_DISABLED' && error.status === 403,
  );
});

test('учётная запись с временным паролем требует смены пароля', async () => {
  await assert.rejects(
    loginWithPocketBase('DEMO-B-01', 'temporary-input', {
      config,
      storage: memoryStorage(),
      fetchImpl: async () => jsonResponse({
        token: 'token',
        record: { kis_code: 'DEMO-B-01', active: true, must_change_password: true },
      }),
    }),
    (error: unknown) => error instanceof AuthError && error.code === 'PASSWORD_CHANGE_REQUIRED' && error.status === 403,
  );
});

test('auth-refresh обновляет токен и отправляет старый в Authorization', async () => {
  const storage = memoryStorage();
  storage.setItem(SESSION_KEY, JSON.stringify({
    token: 'old-token', collection: 'buyers', role: 'buyer', kisCode: 'DEMO-B-01',
  }));
  let authorization = '';
  const refreshed = await refreshPocketBaseSession({
    config, storage,
    fetchImpl: async (url, init) => {
      assert.match(requestUrl(url), /\/buyers\/auth-refresh$/);
      authorization = new Headers(init?.headers).get('Authorization') || '';
      return jsonResponse({ token: 'new-token', record: { kis_code: 'DEMO-B-01', active: true } });
    },
  });

  assert.equal(authorization, 'old-token');
  assert.equal(refreshed?.session.token, 'new-token');
  clearPocketBaseSession(storage);
  assert.equal(getPocketBaseSession(storage), null);
});

test('сетевая ошибка не маскируется под неверный пароль', async () => {
  await assert.rejects(
    loginWithPocketBase('DEMO-B-01', 'input', {
      config,
      storage: memoryStorage(),
      fetchImpl: async () => { throw new Error('offline'); },
    }),
    (error: unknown) => error instanceof AuthError && error.code === 'NETWORK' && /недоступен/.test(error.message),
  );
});

test('конфигурация отклоняет небезопасную схему URL и слишком короткий таймаут', () => {
  assert.throws(() => resolveRuntimeConfig({ VITE_POCKETBASE_URL: 'file:///tmp/pb' }), /http или https/);
  assert.throws(() => resolveRuntimeConfig({ VITE_AUTH_TIMEOUT_MS: '500' }), /не меньше 1000/);
});
