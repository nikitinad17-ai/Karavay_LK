export type AuthMode = 'mock' | 'pocketbase';
export type DataMode = 'mock' | 'directory' | 'remote';

export interface RuntimeConfig {
  readonly authMode: AuthMode;
  readonly dataMode: DataMode;
  readonly pocketBaseUrl: string;
  readonly authTimeoutMs: number;
  readonly buyersCollection: string;
  readonly outletsCollection: string;
}

type RuntimeEnv = Partial<Record<
  | 'VITE_AUTH_MODE'
  | 'VITE_DATA_MODE'
  | 'VITE_POCKETBASE_URL'
  | 'VITE_AUTH_TIMEOUT_MS'
  | 'VITE_POCKETBASE_BUYERS_COLLECTION'
  | 'VITE_POCKETBASE_OUTLETS_COLLECTION',
  string
>>;

export function resolveRuntimeConfig(env: RuntimeEnv = {}): RuntimeConfig {
  const authMode = String(env.VITE_AUTH_MODE || 'pocketbase').trim().toLowerCase();
  const dataMode = String(env.VITE_DATA_MODE || 'remote').trim().toLowerCase();
  const pocketBaseUrl = String(env.VITE_POCKETBASE_URL || '').trim().replace(/\/+$/, '');
  const authTimeoutMs = Number(env.VITE_AUTH_TIMEOUT_MS || 12000);

  if (authMode !== 'mock' && authMode !== 'pocketbase') throw new Error('VITE_AUTH_MODE должен быть mock или pocketbase');
  if (dataMode !== 'mock' && dataMode !== 'directory' && dataMode !== 'remote') {
    throw new Error('VITE_DATA_MODE должен быть mock, directory или remote');
  }
  if (pocketBaseUrl) {
    let parsed;
    try { parsed = new URL(pocketBaseUrl); } catch { throw new Error('VITE_POCKETBASE_URL должен быть корректным URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('VITE_POCKETBASE_URL поддерживает только http или https');
  }
  if (!Number.isFinite(authTimeoutMs) || authTimeoutMs < 1000) throw new Error('VITE_AUTH_TIMEOUT_MS должен быть числом не меньше 1000');

  const buyersCollection = String(env.VITE_POCKETBASE_BUYERS_COLLECTION || 'buyers').trim();
  const outletsCollection = String(env.VITE_POCKETBASE_OUTLETS_COLLECTION || 'outlets').trim();
  if (!buyersCollection || !outletsCollection) throw new Error('Имена auth-коллекций PocketBase не могут быть пустыми');

  return Object.freeze({
    authMode,
    dataMode,
    pocketBaseUrl,
    authTimeoutMs,
    buyersCollection,
    outletsCollection,
  });
}

export const runtimeConfig = resolveRuntimeConfig(import.meta.env || {});
export const isMockAuthMode = () => runtimeConfig.authMode === 'mock';
export const isPocketBaseAuthMode = () => runtimeConfig.authMode === 'pocketbase';
export const isMockDataMode = () => runtimeConfig.dataMode === 'mock';
export const isPocketBaseDirectoryMode = () => runtimeConfig.dataMode === 'directory';
