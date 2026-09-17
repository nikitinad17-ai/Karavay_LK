import { AuthError } from './authApi';
import type { FetchLike, PocketBaseAuthResult } from './authApi';
import { runtimeConfig } from './runtimeConfig';
import type { RuntimeConfig } from './runtimeConfig';
import type {
  Buyer, BuyerAccessRole, BuyerMembership, Outlet, SelectedBuyerContext, UserBuyerAccess, UserDirectory,
} from './types';

interface DirectoryOptions {
  config?: RuntimeConfig;
  fetchImpl?: FetchLike;
}

interface PocketBaseListPayload {
  page?: unknown;
  totalPages?: unknown;
  items?: unknown;
  message?: unknown;
}

interface PocketBaseDirectoryRecord {
  id?: unknown;
  user?: unknown;
  buyer?: unknown;
  role?: unknown;
  active?: unknown;
  kis_code?: unknown;
  kis_id?: unknown;
  name?: unknown;
  address?: unknown;
  min_order_sum?: unknown;
  manager?: unknown;
  manager_phone?: unknown;
  inn?: unknown;
  contact_email?: unknown;
}

const MEMBERSHIP_FIELDS = ['id', 'user', 'buyer', 'role', 'active'].join(',');
const BUYER_FIELDS = [
  'id', 'kis_code', 'kis_id', 'name', 'active', 'min_order_sum',
  'manager', 'manager_phone', 'inn', 'contact_email',
].join(',');
const OUTLET_FIELDS = ['id', 'kis_code', 'kis_id', 'name', 'address', 'buyer', 'active', 'min_order_sum'].join(',');

function requestId(): string {
  try { return globalThis.crypto.randomUUID(); } catch { return `directory-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

function recordsPath(config: RuntimeConfig, collection: string, suffix = ''): string {
  return `${config.pocketBaseUrl}/api/collections/${encodeURIComponent(collection)}/records${suffix}`;
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function responseMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object' || !('message' in value)) return fallback;
  const message = (value as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

async function requestJson(
  path: string,
  token: string,
  config: RuntimeConfig,
  fetchImpl: FetchLike,
): Promise<unknown> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), config.authTimeoutMs) : null;
  try {
    const response = await fetchImpl(path, {
      method: 'GET',
      headers: { Authorization: token, 'X-Request-ID': requestId() },
      ...(controller ? { signal: controller.signal } : {}),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 || response.status === 404
        ? 'DIRECTORY_ACCESS_DENIED'
        : 'DIRECTORY_ERROR';
      throw new AuthError(
        code,
        responseMessage(payload, 'Не удалось получить каталог доступа из PocketBase.'),
        response.status,
      );
    }
    return payload;
  } catch (error: unknown) {
    if (error instanceof AuthError) throw error;
    if (controller?.signal.aborted) {
      throw new AuthError('TIMEOUT', `PocketBase не ответил за ${config.authTimeoutMs / 1000} сек.`, 408);
    }
    throw new AuthError('NETWORK', 'PocketBase недоступен. Проверьте адрес сервера и соединение.');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function asRecord(value: unknown, label: string): PocketBaseDirectoryRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthError('DIRECTORY_INVALID_RECORD', `${label}: PocketBase вернул запись неверного формата.`, 422);
  }
  return value as PocketBaseDirectoryRecord;
}

function listPayload(value: unknown, label: string): PocketBaseListPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthError('DIRECTORY_INVALID_RESPONSE', `${label}: PocketBase вернул неверный список.`, 502);
  }
  return value as PocketBaseListPayload;
}

function requiredText(value: unknown, field: string, label: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw new AuthError('DIRECTORY_INVALID_RECORD', `${label}: заполните поле ${field}.`, 422);
  return result;
}

function optionalText(value: unknown): string | null {
  const result = typeof value === 'string' ? value.trim() : '';
  return result || null;
}

function requiredPocketBaseId(value: unknown, field: string, label: string): string {
  const id = requiredText(value, field, label);
  if (!/^[A-Za-z0-9]+$/.test(id)) {
    throw new AuthError('DIRECTORY_INVALID_RECORD', `${label}: поле ${field} имеет неверный формат.`, 422);
  }
  return id;
}

function relationId(value: unknown, field: string, label: string): string {
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new AuthError('DIRECTORY_INVALID_RECORD', `${label}: связь ${field} должна содержать одну запись.`, 422);
    }
    return requiredPocketBaseId(value[0], field, label);
  }
  return requiredPocketBaseId(value, field, label);
}

function requiredKisId(value: unknown, label: string): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new AuthError('DIRECTORY_INVALID_RECORD', `${label}: поле kis_id должно быть положительным целым числом.`, 422);
  }
  return result;
}

function nonNegativeNumber(value: unknown, field: string, label: string): number {
  const result = typeof value === 'number' ? value : Number(value || 0);
  if (!Number.isFinite(result) || result < 0) {
    throw new AuthError('DIRECTORY_INVALID_RECORD', `${label}: поле ${field} должно быть неотрицательным числом.`, 422);
  }
  return result;
}

function requireActive(value: unknown, label: string): void {
  if (value === false) throw new AuthError('DIRECTORY_ACCESS_DENIED', `${label}: запись отключена.`, 403);
  if (value !== true) {
    throw new AuthError('DIRECTORY_INVALID_RECORD', `${label}: отсутствует корректный флаг active.`, 422);
  }
}

function membershipRole(value: unknown, label: string): BuyerAccessRole {
  if (value === 'owner' || value === 'manager' || value === 'viewer') return value;
  throw new AuthError('DIRECTORY_INVALID_RECORD', `${label}: неизвестная роль доступа.`, 422);
}

function toMembership(value: unknown, expectedUserId: string): BuyerMembership | null {
  const record = asRecord(value, 'Связь пользователя с покупателем');
  const label = `Связь ${optionalText(record.id) || ''}`.trim();
  const userId = relationId(record.user, 'user', label);
  if (userId !== expectedUserId) {
    throw new AuthError('DIRECTORY_SCOPE_VIOLATION', 'PocketBase вернул связь другого пользователя.', 403);
  }
  if (record.active === false) return null;
  if (record.active !== true) {
    throw new AuthError('DIRECTORY_INVALID_RECORD', `${label}: отсутствует корректный флаг active.`, 422);
  }
  return {
    id: requiredPocketBaseId(record.id, 'id', label),
    userId,
    buyerId: relationId(record.buyer, 'buyer', label),
    role: membershipRole(record.role, label),
    active: true,
  };
}

function toBuyer(value: unknown): Buyer {
  const record = asRecord(value, 'Покупатель');
  const recordId = requiredPocketBaseId(record.id, 'id', 'Покупатель');
  const label = `Покупатель ${optionalText(record.kis_code) || recordId}`;
  requireActive(record.active, label);
  const kisId = requiredKisId(record.kis_id, label);
  const name = requiredText(record.name, 'name', label);
  return {
    recordId,
    id: kisId,
    Id_pay: kisId,
    code: requiredText(record.kis_code, 'kis_code', label),
    name,
    legal: name,
    manager: optionalText(record.manager),
    managerPhone: optionalText(record.manager_phone),
    balance: 0,
    minOrderSum: nonNegativeNumber(record.min_order_sum, 'min_order_sum', label),
    shipmentRule: null,
    inn: optionalText(record.inn),
    segment: null,
    hasContract: true,
    contractNumber: null,
    contractDate: null,
    paymentDeferralDays: 0,
    email: optionalText(record.contact_email),
    sinceYear: null,
    shipmentMode: 'allowed',
    shipmentBlockReason: null,
    shipmentEffective: 'allowed',
    shipmentEffectiveReason: null,
    shipmentEffectiveCause: null,
    usesEdi: false,
    ediClientCode: null,
    badges: [],
    outlets: [],
  };
}

function toOutlet(value: unknown, expectedBuyerId: string): Outlet {
  const record = asRecord(value, 'Получатель');
  const recordId = requiredPocketBaseId(record.id, 'id', 'Получатель');
  const label = `Получатель ${optionalText(record.kis_code) || recordId}`;
  requireActive(record.active, label);
  const buyerRecordId = relationId(record.buyer, 'buyer', label);
  if (buyerRecordId !== expectedBuyerId) {
    throw new AuthError('DIRECTORY_SCOPE_VIOLATION', `${label}: связь buyer не совпадает с выбранным покупателем.`, 403);
  }
  const kisId = requiredKisId(record.kis_id, label);
  return {
    recordId,
    buyerRecordId,
    id: kisId,
    id_clt: kisId,
    code: requiredText(record.kis_code, 'kis_code', label),
    name: requiredText(record.name, 'name', label),
    address: optionalText(record.address) || '',
    minOrderSum: nonNegativeNumber(record.min_order_sum, 'min_order_sum', label),
    rep: null,
    days: [],
    daysLabel: '',
    phones: [],
    repPhone: null,
    receiver: null,
    dispatchPhone: null,
    dispatchPlatformName: null,
  };
}

async function loadPagedRecords(
  path: string,
  fields: string,
  token: string,
  config: RuntimeConfig,
  fetchImpl: FetchLike,
  label: string,
): Promise<unknown[]> {
  const result: unknown[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const query = new URLSearchParams({
      page: String(page),
      perPage: '200',
      fields: `page,totalPages,items.${fields.split(',').join(',items.')}`,
    });
    const payload = listPayload(await requestJson(`${path}${separator}${query}`, token, config, fetchImpl), label);
    if (!Array.isArray(payload.items)) {
      throw new AuthError('DIRECTORY_INVALID_RESPONSE', `${label}: PocketBase не вернул массив items.`, 502);
    }
    totalPages = Number(payload.totalPages || 1);
    if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 50) {
      throw new AuthError('DIRECTORY_INVALID_RESPONSE', `${label}: PocketBase вернул неверное число страниц.`, 502);
    }
    result.push(...payload.items);
  }
  return result;
}

async function loadMemberships(
  userId: string,
  token: string,
  config: RuntimeConfig,
  fetchImpl: FetchLike,
): Promise<BuyerMembership[]> {
  const query = new URLSearchParams({
    sort: 'buyer',
    filter: `user = "${userId}" && active = true`,
  });
  const raw = await loadPagedRecords(
    `${recordsPath(config, config.userBuyersCollection)}?${query}`,
    MEMBERSHIP_FIELDS,
    token,
    config,
    fetchImpl,
    'Связи пользователя',
  );
  const memberships = raw.map((item) => toMembership(item, userId)).filter((item): item is BuyerMembership => Boolean(item));
  const uniqueBuyers = new Set(memberships.map((item) => item.buyerId));
  if (uniqueBuyers.size !== memberships.length) {
    throw new AuthError('DIRECTORY_DUPLICATE_ACCESS', 'Обнаружены дублирующиеся связи user + buyer.', 422);
  }
  return memberships;
}

async function loadBuyer(
  buyerId: string,
  token: string,
  config: RuntimeConfig,
  fetchImpl: FetchLike,
): Promise<Buyer> {
  const query = new URLSearchParams({ fields: BUYER_FIELDS });
  const value = await requestJson(
    `${recordsPath(config, config.buyersCollection, `/${encodeURIComponent(buyerId)}`)}?${query}`,
    token,
    config,
    fetchImpl,
  );
  const buyer = toBuyer(value);
  if (buyer.recordId !== buyerId) {
    throw new AuthError('DIRECTORY_SCOPE_VIOLATION', 'PocketBase вернул другого покупателя.', 403);
  }
  return buyer;
}

export async function loadBuyerOutlets(
  buyerId: string,
  token: string,
  options: DirectoryOptions = {},
): Promise<Outlet[]> {
  const config = options.config || runtimeConfig;
  const fetchImpl = options.fetchImpl || fetch;
  const query = new URLSearchParams({
    sort: 'kis_code',
    filter: `buyer = "${buyerId}" && active = true`,
  });
  const raw = await loadPagedRecords(
    `${recordsPath(config, config.outletsCollection)}?${query}`,
    OUTLET_FIELDS,
    token,
    config,
    fetchImpl,
    'Получатели',
  );
  return raw.map((item) => toOutlet(item, buyerId));
}

export async function loadUserDirectory(
  auth: PocketBaseAuthResult,
  options: DirectoryOptions = {},
): Promise<UserDirectory> {
  const config = options.config || runtimeConfig;
  const fetchImpl = options.fetchImpl || fetch;
  if (auth.session.userId !== auth.user.id) {
    throw new AuthError('SESSION_USER_MISMATCH', 'Сессия и пользователь PocketBase не совпадают.', 409);
  }
  const memberships = await loadMemberships(auth.user.id, auth.session.token, config, fetchImpl);
  if (!memberships.length) {
    throw new AuthError('NO_BUYER_ACCESS', 'Пользователю не назначен доступ ни к одному покупателю.', 403);
  }
  const buyers = await Promise.all(memberships.map((membership) => (
    loadBuyer(membership.buyerId, auth.session.token, config, fetchImpl)
  )));
  const accesses: UserBuyerAccess[] = memberships.map((membership, index) => ({
    membership,
    buyer: buyers[index],
  }));
  return { user: auth.user, accesses };
}

export function findBuyerAccess(directory: UserDirectory, buyerId: string): UserBuyerAccess {
  const access = directory.accesses.find((item) => (
    item.membership.active
    && item.membership.userId === directory.user.id
    && item.membership.buyerId === buyerId
    && item.buyer.recordId === buyerId
  ));
  if (!access) {
    throw new AuthError('INVALID_BUYER_SELECTION', 'Нет доступа к выбранному покупателю.', 403);
  }
  return access;
}

export function resolveInitialBuyerId(directory: UserDirectory, storedBuyerId: string | null): string | null {
  if (storedBuyerId) {
    const stored = directory.accesses.find((item) => item.membership.buyerId === storedBuyerId);
    if (stored) return storedBuyerId;
  }
  return directory.accesses.length === 1 ? directory.accesses[0].membership.buyerId : null;
}

export async function loadSelectedBuyerContext(
  directory: UserDirectory,
  buyerId: string,
  token: string,
  options: DirectoryOptions = {},
): Promise<SelectedBuyerContext> {
  const access = findBuyerAccess(directory, buyerId);
  const outlets = await loadBuyerOutlets(buyerId, token, options);
  const buyer = { ...access.buyer, outlets: outlets.map((outlet) => ({ ...outlet })) };
  return {
    userId: directory.user.id,
    buyerId,
    membership: { ...access.membership },
    buyer,
    outlets,
  };
}
