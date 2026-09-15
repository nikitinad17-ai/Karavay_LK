import { runtimeConfig } from './runtimeConfig';
import type { RuntimeConfig } from './runtimeConfig';
import type { Role } from './types';

const SESSION_KEY = 'karavay_pocketbase_session_v1';

export interface PocketBaseSession {
  token: string;
  collection: string;
  role: Role;
  kisCode: string;
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

interface PocketBaseRecord {
  active?: boolean;
  kis_code?: unknown;
  must_change_password?: boolean;
}

interface PocketBasePayload {
  token?: unknown;
  record?: PocketBaseRecord;
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
    return value && typeof value === 'object' ? value as PocketBasePayload : {};
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

async function authenticateCollection(
  collection: string,
  identity: string,
  password: string,
  options: RequiredAuthOptions,
): Promise<PocketBasePayload> {
  const response = await fetchWithDeadline(collectionPath(options.config, collection, 'auth-with-password'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password }),
  }, options);
  const payload = await readJson(response);
  if (!response.ok) {
    throw new AuthError(
      response.status === 400 ? 'INVALID_CREDENTIALS' : 'POCKETBASE_ERROR',
      messageFromPocketBase(payload, 'Не удалось выполнить вход через PocketBase.'),
      response.status,
    );
  }
  if (typeof payload.token !== 'string' || !payload.record) {
    throw new AuthError('INVALID_RESPONSE', 'PocketBase вернул неполный ответ авторизации.', response.status);
  }
  return payload;
}

function sessionFromPayload(payload: PocketBasePayload, collection: string, config: RuntimeConfig): PocketBaseSession {
  const record = payload.record;
  if (!record || typeof payload.token !== 'string') {
    throw new AuthError('INVALID_RESPONSE', 'PocketBase вернул неполный ответ авторизации.');
  }
  if (record.active === false) throw new AuthError('ACCOUNT_DISABLED', 'Учётная запись отключена администратором.', 403);
  if (record.must_change_password === true) {
    throw new AuthError('PASSWORD_CHANGE_REQUIRED', 'Для учётной записи требуется смена временного пароля.', 403);
  }
  return {
    token: payload.token,
    collection,
    role: collection === config.buyersCollection ? 'buyer' : 'outlet',
    kisCode: String(record.kis_code || '').trim(),
  };
}

function isPocketBaseSession(value: unknown): value is PocketBaseSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<PocketBaseSession>;
  return typeof session.token === 'string' && Boolean(session.token)
    && typeof session.collection === 'string' && Boolean(session.collection)
    && (session.role === 'buyer' || session.role === 'outlet')
    && typeof session.kisCode === 'string' && Boolean(session.kisCode);
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

export function clearPocketBaseSession(storage?: StorageLike): void {
  storageOf(storage)?.removeItem(SESSION_KEY);
}

export async function loginWithPocketBase(identity: string, password: string, options: AuthOptions = {}): Promise<PocketBaseSession> {
  const config = options.config || runtimeConfig;
  const fetchImpl = options.fetchImpl || fetch;
  const cleanIdentity = String(identity || '').trim();
  if (!cleanIdentity || !password) throw new AuthError('MISSING_CREDENTIALS', 'Введите код и пароль.');

  let payload: PocketBasePayload;
  let collection = config.buyersCollection;
  try {
    payload = await authenticateCollection(collection, cleanIdentity, password, { fetchImpl, config });
  } catch (buyerError: unknown) {
    if (!(buyerError instanceof AuthError) || buyerError.code !== 'INVALID_CREDENTIALS') throw buyerError;
    collection = config.outletsCollection;
    try {
      payload = await authenticateCollection(collection, cleanIdentity, password, { fetchImpl, config });
    } catch (outletError: unknown) {
      if (outletError instanceof AuthError && outletError.code === 'INVALID_CREDENTIALS') {
        throw new AuthError('INVALID_CREDENTIALS', 'Неверный код или пароль.', 400);
      }
      throw outletError;
    }
  }

  const session = sessionFromPayload(payload, collection, config);
  if (!session.kisCode) throw new AuthError('MISSING_KIS_CODE', 'У учётной записи не заполнено поле kis_code.', 422);
  savePocketBaseSession(session, options.storage);
  return session;
}

export async function refreshPocketBaseSession(options: AuthOptions = {}): Promise<PocketBaseSession | null> {
  const config = options.config || runtimeConfig;
  const fetchImpl = options.fetchImpl || fetch;
  const current = getPocketBaseSession(options.storage);
  if (!current) return null;

  const response = await fetchWithDeadline(collectionPath(config, current.collection, 'auth-refresh'), {
    method: 'POST',
    headers: { Authorization: current.token },
  }, { fetchImpl, config });
  const payload = await readJson(response);
  if (!response.ok) {
    clearPocketBaseSession(options.storage);
    throw new AuthError('SESSION_EXPIRED', 'Сессия истекла. Войдите снова.', response.status);
  }
  const session = sessionFromPayload(payload, current.collection, config);
  if (!session.kisCode) {
    clearPocketBaseSession(options.storage);
    throw new AuthError('MISSING_KIS_CODE', 'У учётной записи не заполнено поле kis_code.', 422);
  }
  savePocketBaseSession(session, options.storage);
  return session;
}

export { SESSION_KEY };
