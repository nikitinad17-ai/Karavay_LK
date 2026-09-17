import assert from 'node:assert/strict';
import { test } from 'vitest';
import { AuthError } from '../src/authApi';
import type { FetchLike, PocketBaseAuthResult } from '../src/authApi';
import {
  findBuyerAccess, loadSelectedBuyerContext, loadUserDirectory, resolveInitialBuyerId,
} from '../src/pocketBaseDirectoryApi';
import { createRequestGate } from '../src/requestGate';
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

const userAuth: PocketBaseAuthResult = {
  session: { token: 'user-token', collection: 'users', userId: 'userrecord00001', login: 'ivan.petrov' },
  user: {
    id: 'userrecord00001', login: 'ivan.petrov', name: 'Иван Петров', active: true, mustChangePassword: false,
  },
  record: {
    id: 'userrecord00001', login: 'ivan.petrov', name: 'Иван Петров', active: true, must_change_password: false,
  },
};

function membership(id: string, buyerId: string, active = true) {
  return { id, user: userAuth.user.id, buyer: buyerId, role: 'manager', active };
}

function buyer(id: string, kisId: number, code: string, name: string) {
  return { id, kis_id: kisId, kis_code: code, name, active: true, min_order_sum: 0 };
}

function outlet(id: string, buyerId: string, kisId: number, code: string, name: string) {
  return {
    id, buyer: buyerId, kis_id: kisId, kis_code: code, name, address: `Адрес ${name}`, active: true, min_order_sum: 0,
  };
}

function list(items: unknown[]) {
  return { page: 1, totalPages: 1, items };
}

function directoryFetch(memberships: unknown[], buyers: Record<string, unknown>): FetchLike {
  return async (input, init) => {
    const url = requestUrl(input);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'user-token');
    if (url.pathname.includes('/user_buyers/records')) return jsonResponse(list(memberships));
    const buyerId = url.pathname.split('/').at(-1) || '';
    if (url.pathname.includes('/buyers/records/')) {
      return buyers[buyerId] ? jsonResponse(buyers[buyerId]) : jsonResponse({ message: 'Not found.' }, 404);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

test('пользователь с одним покупателем получает его автоматически и только его точки', async () => {
  const buyerId = 'buyerrecord001';
  const baseFetch = directoryFetch(
    [membership('membership0001', buyerId)],
    { [buyerId]: buyer(buyerId, 299271, 'A016', 'Покупатель А') },
  );
  const directory = await loadUserDirectory(userAuth, { config, fetchImpl: baseFetch });
  const selectedId = resolveInitialBuyerId(directory, null);
  assert.equal(selectedId, buyerId);

  let outletFilter = '';
  const context = await loadSelectedBuyerContext(directory, selectedId!, 'user-token', {
    config,
    fetchImpl: async (input, init) => {
      const url = requestUrl(input);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'user-token');
      outletFilter = url.searchParams.get('filter') || '';
      return jsonResponse(list([outlet('outletrecord001', buyerId, 4101, 'M-1467-01', 'Точка А')]));
    },
  });

  assert.equal(context.buyer.code, 'A016');
  assert.equal(context.outlets.length, 1);
  assert.equal(context.outlets[0].buyerRecordId, buyerId);
  assert.match(outletFilter, new RegExp(buyerId));
});

test('пользователь с несколькими покупателями должен увидеть экран выбора', async () => {
  const buyerA = 'buyerrecord001';
  const buyerB = 'buyerrecord002';
  const directory = await loadUserDirectory(userAuth, {
    config,
    fetchImpl: directoryFetch(
      [membership('membership0001', buyerA), membership('membership0002', buyerB)],
      {
        [buyerA]: buyer(buyerA, 1001, 'A001', 'Покупатель А'),
        [buyerB]: buyer(buyerB, 1002, 'B001', 'Покупатель Б'),
      },
    ),
  });

  assert.equal(directory.accesses.length, 2);
  assert.equal(resolveInitialBuyerId(directory, null), null);
});

test('переключение покупателя загружает только его получателей', async () => {
  const buyerA = 'buyerrecord001';
  const buyerB = 'buyerrecord002';
  const directory = await loadUserDirectory(userAuth, {
    config,
    fetchImpl: directoryFetch(
      [membership('membership0001', buyerA), membership('membership0002', buyerB)],
      {
        [buyerA]: buyer(buyerA, 1001, 'A001', 'Покупатель А'),
        [buyerB]: buyer(buyerB, 1002, 'B001', 'Покупатель Б'),
      },
    ),
  });
  let requestedFilter = '';
  const context = await loadSelectedBuyerContext(directory, buyerB, 'user-token', {
    config,
    fetchImpl: async (input) => {
      const url = requestUrl(input);
      requestedFilter = url.searchParams.get('filter') || '';
      return jsonResponse(list([outlet('outletrecord002', buyerB, 4201, 'B-01', 'Точка Б')]));
    },
  });

  assert.equal(context.buyerId, buyerB);
  assert.deepEqual(context.outlets.map((item) => item.code), ['B-01']);
  assert.match(requestedFilter, new RegExp(buyerB));
  assert.doesNotMatch(requestedFilter, new RegExp(buyerA));
});

test('пользователь без связей получает NO_BUYER_ACCESS', async () => {
  await assert.rejects(
    loadUserDirectory(userAuth, { config, fetchImpl: directoryFetch([], {}) }),
    (error: unknown) => error instanceof AuthError && error.code === 'NO_BUYER_ACCESS',
  );
});

test('неактивная связь user_buyers не даёт доступ', async () => {
  const buyerId = 'buyerrecord001';
  await assert.rejects(
    loadUserDirectory(userAuth, {
      config,
      fetchImpl: directoryFetch(
        [membership('membership0001', buyerId, false)],
        { [buyerId]: buyer(buyerId, 1001, 'A001', 'Покупатель А') },
      ),
    }),
    (error: unknown) => error instanceof AuthError && error.code === 'NO_BUYER_ACCESS',
  );
});

test('пользователь не может выбрать чужого покупателя и запрос не отправляется', async () => {
  const buyerId = 'buyerrecord001';
  const directory = await loadUserDirectory(userAuth, {
    config,
    fetchImpl: directoryFetch(
      [membership('membership0001', buyerId)],
      { [buyerId]: buyer(buyerId, 1001, 'A001', 'Покупатель А') },
    ),
  });
  assert.throws(
    () => findBuyerAccess(directory, 'foreignbuyer001'),
    (error: unknown) => error instanceof AuthError && error.code === 'INVALID_BUYER_SELECTION',
  );
  let calls = 0;
  await assert.rejects(
    loadSelectedBuyerContext(directory, 'foreignbuyer001', 'user-token', {
      config,
      fetchImpl: async () => { calls += 1; return jsonResponse(list([])); },
    }),
    (error: unknown) => error instanceof AuthError && error.code === 'INVALID_BUYER_SELECTION',
  );
  assert.equal(calls, 0);
});

test('получатель с чужой relation buyer блокируется fail-closed', async () => {
  const buyerId = 'buyerrecord001';
  const directory = await loadUserDirectory(userAuth, {
    config,
    fetchImpl: directoryFetch(
      [membership('membership0001', buyerId)],
      { [buyerId]: buyer(buyerId, 1001, 'A001', 'Покупатель А') },
    ),
  });
  await assert.rejects(
    loadSelectedBuyerContext(directory, buyerId, 'user-token', {
      config,
      fetchImpl: async () => jsonResponse(list([
        outlet('outletrecord001', 'foreignbuyer001', 4101, 'X-01', 'Чужая точка'),
      ])),
    }),
    (error: unknown) => error instanceof AuthError && error.code === 'DIRECTORY_SCOPE_VIOLATION',
  );
});

test('F5 повторно проверяет связи до восстановления выбранного покупателя', async () => {
  const revokedBuyer = 'buyerrecord002';
  const currentA = 'buyerrecord001';
  const currentC = 'buyerrecord003';
  const refreshedDirectory = await loadUserDirectory(userAuth, {
    config,
    fetchImpl: directoryFetch(
      [membership('membership0001', currentA), membership('membership0003', currentC)],
      {
        [currentA]: buyer(currentA, 1001, 'A001', 'Покупатель А'),
        [currentC]: buyer(currentC, 1003, 'C001', 'Покупатель В'),
      },
    ),
  });

  assert.equal(resolveInitialBuyerId(refreshedDirectory, revokedBuyer), null);
  assert.throws(() => findBuyerAccess(refreshedDirectory, revokedBuyer), /Нет доступа/);
});

test('быстрое переключение не применяет устаревший ответ', async () => {
  const gate = createRequestGate();
  const applied: string[] = [];
  let finishFirst: () => void = () => {};
  const first = new Promise<void>((resolve) => { finishFirst = resolve; });
  const firstId = gate.begin('selectedBuyer');
  const firstApply = first.then(() => {
    if (gate.isLatest('selectedBuyer', firstId)) applied.push('buyer-a');
  });
  const secondId = gate.begin('selectedBuyer');
  if (gate.isLatest('selectedBuyer', secondId)) applied.push('buyer-b');
  finishFirst();
  await firstApply;
  assert.deepEqual(applied, ['buyer-b']);
});
