import { runtimeConfig } from './runtimeConfig';
import type { RuntimeConfig } from './runtimeConfig';
import type { AuthenticatedUser } from './types';

const SESSION_KEY = 'karavay_pocketbase_user_session_v2';
const SELECTED_BUYER_KEY = 'karavay_selected_buyer_v1';

export interface PocketBaseSession {
  token: string;
  collection: string;
  userId: string;
  login: string;
}

export interface PocketBaseUserRecord {
  id?: unknown;
  login?: unknown;
  name?: unknown;
  active?: unknown;
  must_change_password?: unknown;
}

export interface PocketBaseAuthResult {
  session: PocketBaseSession;
  user: AuthenticatedUser;
  record: PocketBaseUserRecord;
}

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AuthOptions {
  config?: RuntimeConfig;
  fetchImpl?: FetchLike;
  storage?: StorageLike;
}

interface RequiredAuthOptions {
  config: RuntimeConfig;
  fetchImpl: FetchLike;
}

interface PocketBasePayload {
  token?: unknown;
  record?: unknown;
  message?: unknown;
  data?: Record<string, unknown>;
}

export class AuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

function storageOf(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try { return window.sessionStorage; } catch { return null; }
}

function collectionPath(config: RuntimeConfig, collection: string, action: string): string {
  return `${config.pocketBaseUrl}/api/collections/${encodeURIComponent(collection)}/${action}`;
}

async function readJson(response: Response): Promise<PocketBasePayload> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as PocketBasePayload : {};
  } catch {
    return {};
  }
}

function nestedFieldMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('message' in value)) return null;
  const message = (value as { message?: unknown }).message;
  return typeof message === 'string' && message ? message : null;
}

function messageFromPocketBase(payload: PocketBasePayload, fallback: string): string {
  const fields = payload.data ? Object.values(payload.data) : [];
  const fieldMessage = fields.map(nestedFieldMessage).find(Boolean);
  return fieldMessage || (typeof payload.message === 'string' ? payload.message : fallback);
}

function requestId(): string {
  try { return globalThis.crypto.randomUUID(); } catch { return `auth-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  options: RequiredAuthOptions,
): Promise<Response> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timeoutMs = options.config.authTimeoutMs;
  const id = requestId();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await options.fetchImpl(url, {
      ...init,
      headers: { ...init.headers, 'X-Request-ID': id },
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch {
    if (controller?.signal.aborted) {
      throw new AuthError('TIMEOUT', `PocketBase не ответил за ${timeoutMs / 1000} сек.`, 408);
    }
    throw new AuthError('NETWORK', 'PocketBase недоступен. Проверьте адрес сервера и соединение.');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function asUserRecord(value: unknown): PocketBaseUserRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthError('INVALID_USER_SCHEMA', 'PocketBase вернул запись пользователя неверного формата.', 422);
  }
  return value as PocketBaseUserRecord;
}

function requiredText(value: unknown, field: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw new AuthError('INVALID_USER_SCHEMA', `У пользователя не заполнено поле ${field}.`, 422);
  return result;
}

export function authenticatedUserFromRecord(value: unknown): AuthenticatedUser {
  const record = asUserRecord(value);
  const id = requiredText(record.id, 'id');
  if (!/^[A-Za-z0-9]+$/.test(id)) {
    throw new AuthError('INVALID_USER_SCHEMA', 'PocketBase id пользователя имеет неверный формат.', 422);
  }
  if (record.active === false) {
    throw new AuthError('ACCOUNT_DISABLED', 'Учётная запись отключена администратором.', 403);
  }
  if (record.active !== true) {
    throw new AuthError('INVALID_USER_SCHEMA', 'У пользователя отсутствует корректный флаг active.', 422);
  }
  if (record.must_change_password === true) {
    throw new AuthError('PASSWORD_CHANGE_REQUIRED', 'Для учётной записи требуется смена временного пароля.', 403);
  }
  if (record.must_change_password !== false) {
    throw new AuthError('INVALID_USER_SCHEMA', 'У пользователя отсутствует корректный флаг must_change_password.', 422);
  }
  return {
    id,
    login: requiredText(record.login, 'login'),
    name: requiredText(record.name, 'name'),
    active: true,
    mustChangePassword: false,
  };
}

function authResultFromPayload(payload: PocketBasePayload, config: RuntimeConfig): PocketBaseAuthResult {
  if (typeof payload.token !== 'string' || !payload.token) {
    throw new AuthError('INVALID_RESPONSE', 'PocketBase вернул неполный ответ авторизации.');
  }
  const record = asUserRecord(payload.record);
  const user = authenticatedUserFromRecord(record);
  return {
    session: {
      token: payload.token,
      collection: config.usersCollection,
      userId: user.id,
      login: user.login,
    },
    user,
    record,
  };
}

function isPocketBaseSession(value: unknown): value is PocketBaseSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<PocketBaseSession>;
  return typeof session.token === 'string' && Boolean(session.token)
    && typeof session.collection === 'string' && Boolean(session.collection)
    && typeof session.userId === 'string' && Boolean(session.userId)
    && typeof session.login === 'string' && Boolean(session.login);
}

export function savePocketBaseSession(session: PocketBaseSession, storage?: StorageLike): void {
  storageOf(storage)?.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getPocketBaseSession(storage?: StorageLike): PocketBaseSession | null {
  const target = storageOf(storage);
  if (!target) return null;
  try {
    const session: unknown = JSON.parse(target.getItem(SESSION_KEY) || 'null');
    return isPocketBaseSession(session) ? session : null;
  } catch {
    return null;
  }
}

export function saveSelectedBuyerId(buyerId: string, storage?: StorageLike): void {
  const value = String(buyerId || '').trim();
  if (!value) throw new AuthError('INVALID_BUYER_SELECTION', 'Не выбран покупатель.', 422);
  storageOf(storage)?.setItem(SELECTED_BUYER_KEY, value);
}

export function getSelectedBuyerId(storage?: StorageLike): string | null {
  const value = storageOf(storage)?.getItem(SELECTED_BUYER_KEY) || '';
  return value.trim() || null;
}

export function clearSelectedBuyerId(storage?: StorageLike): void {
  storageOf(storage)?.removeItem(SELECTED_BUYER_KEY);
}

export function clearPocketBaseSession(storage?: StorageLike): void {
  const target = storageOf(storage);
  target?.removeItem(SESSION_KEY);
  target?.removeItem(SELECTED_BUYER_KEY);
}

export async function loginWithPocketBase(identity: string, password: string, options: AuthOptions = {}): Promise<PocketBaseAuthResult> {
  const config = options.config || runtimeConfig;
  const fetchImpl = options.fetchImpl || fetch;
  const cleanIdentity = String(identity || '').trim();
  if (!cleanIdentity || !password) throw new AuthError('MISSING_CREDENTIALS', 'Введите логин и пароль.');

  const response = await fetchWithDeadline(collectionPath(config, config.usersCollection, 'auth-with-password'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: cleanIdentity, password }),
  }, { fetchImpl, config });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new AuthError(
      response.status === 400 ? 'INVALID_CREDENTIALS' : 'POCKETBASE_ERROR',
      response.status === 400
        ? 'Неверный логин или пароль.'
        : messageFromPocketBase(payload, 'Не удалось выполнить вход через PocketBase.'),
      response.status,
    );
  }

  const result = authResultFromPayload(payload, config);
  clearSelectedBuyerId(options.storage);
  savePocketBaseSession(result.session, options.storage);
  return result;
}

export async function refreshPocketBaseSession(options: AuthOptions = {}): Promise<PocketBaseAuthResult | null> {
  const config = options.config || runtimeConfig;
  const fetchImpl = options.fetchImpl || fetch;
  const current = getPocketBaseSession(options.storage);
  if (!current) return null;
  if (current.collection !== config.usersCollection) {
    clearPocketBaseSession(options.storage);
    throw new AuthError('SESSION_EXPIRED', 'Сессия относится к устаревшей схеме входа. Войдите снова.', 401);
  }

  const response = await fetchWithDeadline(collectionPath(config, config.usersCollection, 'auth-refresh'), {
    method: 'POST',
    headers: { Authorization: current.token },
  }, { fetchImpl, config });
  const payload = await readJson(response);
  if (!response.ok) {
    clearPocketBaseSession(options.storage);
    throw new AuthError('SESSION_EXPIRED', 'Сессия истекла. Войдите снова.', response.status);
  }
  const result = authResultFromPayload(payload, config);
  if (result.user.id !== current.userId) {
    clearPocketBaseSession(options.storage);
    throw new AuthError('SESSION_USER_MISMATCH', 'PocketBase вернул сессию другого пользователя.', 409);
  }
  savePocketBaseSession(result.session, options.storage);
  return result;
}

export { SELECTED_BUYER_KEY, SESSION_KEY };
