import { AuthError } from './authApi';
import type { FetchLike, PocketBaseAuthResult, PocketBaseRecord } from './authApi';
import { runtimeConfig } from './runtimeConfig';
import type { RuntimeConfig } from './runtimeConfig';
import type { KisClient, KisPayer, LoginResponse } from './types';

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

const DIRECTORY_FIELDS = [
  'id', 'kis_code', 'kis_id', 'name', 'address', 'buyer', 'active',
  'must_change_password', 'min_order_sum', 'manager', 'manager_phone',
  'inn', 'contact_email',
].join(',');

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
      const code = response.status === 403 || response.status === 404
        ? 'DIRECTORY_ACCESS_DENIED'
        : 'DIRECTORY_ERROR';
      throw new AuthError(
        code,
        responseMessage(payload, 'Не удалось получить профиль из PocketBase.'),
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

function asRecord(value: unknown, label: string): PocketBaseRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthError('DIRECTORY_INVALID_RECORD', `${label}: PocketBase вернул запись неверного формата.`, 422);
  }
  return value as PocketBaseRecord;
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

function requiredKisId(value: unknown, label: string): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new AuthError('DIRECTORY_INVALID_RECORD', `${label}: поле kis_id должно быть положительным целым числом.`, 422);
  }
  return result;
}

function nonNegativeNumber(value: unknown): number {
  const result = typeof value === 'number' ? value : Number(value || 0);
  return Number.isFinite(result) && result >= 0 ? result : 0;
}

function recordId(record: PocketBaseRecord, label: string): string {
  const id = requiredText(record.id, 'id', label);
  if (!/^[A-Za-z0-9]+$/.test(id)) {
    throw new AuthError('DIRECTORY_INVALID_RECORD', `${label}: PocketBase id имеет неверный формат.`, 422);
  }
  return id;
}

function relationId(value: unknown, label: string): string {
  const relation = Array.isArray(value) ? value[0] : value;
  return recordId({ id: relation }, label);
}

function recordLabel(record: PocketBaseRecord, fallback: string): string {
  return optionalText(record.kis_code) || fallback;
}

function assertUsable(record: PocketBaseRecord, label: string): void {
  if (record.active === false) throw new AuthError('ACCOUNT_DISABLED', `${label}: учётная запись отключена.`, 403);
  if (record.must_change_password === true) {
    throw new AuthError('PASSWORD_CHANGE_REQUIRED', `${label}: требуется смена временного пароля.`, 403);
  }
}

function toKisClient(record: PocketBaseRecord): KisClient {
  const label = `Получатель ${recordLabel(record, '')}`.trim();
  assertUsable(record, label);
  const kisId = requiredKisId(record.kis_id, label);
  return {
    lk_id: kisId,
    id_clt: kisId,
    KodClt: requiredText(record.kis_code, 'kis_code', label),
    NameClt: requiredText(record.name, 'name', label),
    Adres: optionalText(record.address) || '',
    OrdLimitMinSum: nonNegativeNumber(record.min_order_sum),
    TorgPred: null,
    lk_days: [],
    lk_phones: [],
    lk_repPhone: null,
    lk_receiver: null,
    lk_dispatchPhone: null,
    lk_dispatchPlatformName: null,
  };
}

function toKisPayer(record: PocketBaseRecord, outlets: PocketBaseRecord[]): KisPayer {
  const label = `Покупатель ${recordLabel(record, '')}`.trim();
  assertUsable(record, label);
  const kisId = requiredKisId(record.kis_id, label);
  const name = requiredText(record.name, 'name', label);
  return {
    lk_id: kisId,
    Id_pay: kisId,
    KodPay: requiredText(record.kis_code, 'kis_code', label),
    NamePay: name,
    Adres: name,
    Manager: optionalText(record.manager),
    lk_managerPhone: optionalText(record.manager_phone),
    lk_inn: optionalText(record.inn),
    lk_email: optionalText(record.contact_email),
    OrdLimitMinSum: nonNegativeNumber(record.min_order_sum),
    SumOutSaldoCalc: 0,
    lk_hasContract: true,
    lk_paymentDeferralDays: 0,
    lk_shipmentMode: 'allowed',
    lk_shipmentEffective: 'allowed',
    Clients: outlets.map(toKisClient),
  };
}

function listPayload(value: unknown): PocketBaseListPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthError('DIRECTORY_INVALID_RESPONSE', 'PocketBase вернул неверный список получателей.', 502);
  }
  return value as PocketBaseListPayload;
}

async function loadBuyerOutlets(
  buyerRecordId: string,
  token: string,
  config: RuntimeConfig,
  fetchImpl: FetchLike,
): Promise<PocketBaseRecord[]> {
  const filter = `buyer = "${buyerRecordId}" && active = true && must_change_password = false`;
  const result: PocketBaseRecord[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page += 1) {
    const query = new URLSearchParams({
      page: String(page),
      perPage: '200',
      sort: 'kis_code',
      filter,
      fields: `page,totalPages,items.${DIRECTORY_FIELDS.split(',').join(',items.')}`,
    });
    const payload = listPayload(await requestJson(
      `${recordsPath(config, config.outletsCollection)}?${query}`,
      token,
      config,
      fetchImpl,
    ));
    if (!Array.isArray(payload.items)) {
      throw new AuthError('DIRECTORY_INVALID_RESPONSE', 'PocketBase не вернул массив получателей.', 502);
    }
    totalPages = Number(payload.totalPages || 1);
    if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 25) {
      throw new AuthError('DIRECTORY_INVALID_RESPONSE', 'PocketBase вернул неверное число страниц получателей.', 502);
    }
    result.push(...payload.items.map((item) => asRecord(item, 'Получатель')));
  }
  return result;
}

async function loadParentBuyer(
  buyerRecordId: string,
  token: string,
  config: RuntimeConfig,
  fetchImpl: FetchLike,
): Promise<PocketBaseRecord> {
  const query = new URLSearchParams({ fields: DIRECTORY_FIELDS });
  return asRecord(await requestJson(
    `${recordsPath(config, config.buyersCollection, `/${encodeURIComponent(buyerRecordId)}`)}?${query}`,
    token,
    config,
    fetchImpl,
  ), 'Покупатель');
}

export async function loadPocketBaseDirectory(
  auth: PocketBaseAuthResult,
  options: DirectoryOptions = {},
): Promise<LoginResponse> {
  const config = options.config || runtimeConfig;
  const fetchImpl = options.fetchImpl || fetch;
  const { session, record } = auth;
  const ownRecordId = recordId(record, session.role === 'buyer' ? 'Покупатель' : 'Получатель');

  if (session.role === 'buyer') {
    const outlets = await loadBuyerOutlets(ownRecordId, session.token, config, fetchImpl);
    return { role: 'buyer', payer: toKisPayer(record, outlets) };
  }

  const parentId = relationId(record.buyer, 'Получатель: связь buyer');
  const buyer = await loadParentBuyer(parentId, session.token, config, fetchImpl);
  const client = toKisClient(record);
  return {
    role: 'outlet',
    payer: toKisPayer(buyer, [record]),
    client,
    enteredOutletId: client.lk_id,
  };
}
