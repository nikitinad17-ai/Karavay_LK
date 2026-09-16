import assert from 'node:assert/strict';
import { test } from 'vitest';
import { AuthError } from '../src/authApi';
import type { PocketBaseAuthResult } from '../src/authApi';
import { loadPocketBaseDirectory } from '../src/pocketBaseDirectoryApi';
import { resolveRuntimeConfig } from '../src/runtimeConfig';

const config = resolveRuntimeConfig({
  VITE_AUTH_MODE: 'pocketbase',
  VITE_DATA_MODE: 'directory',
  VITE_POCKETBASE_URL: 'http://pb.test:8090',
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: RequestInfo | URL): URL {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  return new URL(value);
}

const buyerAuth: PocketBaseAuthResult = {
  session: { token: 'buyer-token', collection: 'buyers', role: 'buyer', kisCode: 'A016' },
  record: { id: 'buyerrecord0001', kis_code: 'A016', kis_id: 299271, name: 'Тестовый покупатель', active: true },
};

test('покупатель получает только связанные точки с поддержкой пагинации', async () => {
  const calls: Array<{ url: URL; authorization: string }> = [];
  const response = await loadPocketBaseDirectory(buyerAuth, {
    config,
    fetchImpl: async (input, init) => {
      const url = requestUrl(input);
      calls.push({ url, authorization: new Headers(init?.headers).get('Authorization') || '' });
      const page = Number(url.searchParams.get('page'));
      return jsonResponse({
        page,
        totalPages: 2,
        items: [{
          id: `outletrecord00${page}`,
          kis_code: `M-1467-0${page}`,
          kis_id: 4100 + page,
          name: `Тестовая точка ${page}`,
          address: `Тестовый адрес ${page}`,
          buyer: 'buyerrecord0001',
          active: true,
          must_change_password: false,
        }],
      });
    },
  });

  assert.equal(response.role, 'buyer');
  assert.equal(response.payer.Id_pay, 299271);
  assert.equal(response.payer.KodPay, 'A016');
  assert.equal(response.payer.Clients?.length, 2);
  assert.equal(response.payer.Clients?.[1].KodClt, 'M-1467-02');
  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.authorization === 'buyer-token'), true);
  assert.match(calls[0].url.searchParams.get('filter') || '', /buyerrecord0001/);
});

test('получатель загружает родительского покупателя и видит только себя', async () => {
  const outletAuth: PocketBaseAuthResult = {
    session: { token: 'outlet-token', collection: 'outlets', role: 'outlet', kisCode: 'M-1467-01' },
    record: {
      id: 'outletrecord001',
      kis_code: 'M-1467-01',
      kis_id: 4101,
      name: 'Тестовая точка 1',
      address: 'Тестовый адрес 1',
      buyer: 'buyerrecord0001',
      active: true,
    },
  };
  let requestedPath = '';
  const response = await loadPocketBaseDirectory(outletAuth, {
    config,
    fetchImpl: async (input, init) => {
      const url = requestUrl(input);
      requestedPath = url.pathname;
      assert.equal(new Headers(init?.headers).get('Authorization'), 'outlet-token');
      return jsonResponse({
        id: 'buyerrecord0001',
        kis_code: 'A016',
        kis_id: 299271,
        name: 'Тестовый покупатель',
        active: true,
      });
    },
  });

  assert.match(requestedPath, /\/buyers\/records\/buyerrecord0001$/);
  assert.equal(response.role, 'outlet');
  assert.equal(response.payer.KodPay, 'A016');
  assert.equal(response.client?.KodClt, 'M-1467-01');
  assert.equal(response.payer.Clients?.length, 1);
});

test('неполная запись получателя блокирует открытие кабинета', async () => {
  await assert.rejects(
    loadPocketBaseDirectory(buyerAuth, {
      config,
      fetchImpl: async () => jsonResponse({
        page: 1,
        totalPages: 1,
        items: [{ id: 'outletrecord001', kis_code: 'M-1467-01', name: 'Точка', buyer: 'buyerrecord0001', active: true }],
      }),
    }),
    (error: unknown) => error instanceof AuthError && error.code === 'DIRECTORY_INVALID_RECORD' && /kis_id/.test(error.message),
  );
});

test('ошибка правил доступа PocketBase не маскируется под пустой список', async () => {
  await assert.rejects(
    loadPocketBaseDirectory(buyerAuth, {
      config,
      fetchImpl: async () => jsonResponse({ message: 'Forbidden.' }, 403),
    }),
    (error: unknown) => error instanceof AuthError && error.code === 'DIRECTORY_ACCESS_DENIED' && error.status === 403,
  );
});
