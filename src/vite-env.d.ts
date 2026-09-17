/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_MODE?: 'mock' | 'pocketbase';
  readonly VITE_DATA_MODE?: 'mock' | 'directory' | 'remote';
  readonly VITE_POCKETBASE_URL?: string;
  readonly VITE_AUTH_TIMEOUT_MS?: string;
  readonly VITE_POCKETBASE_USERS_COLLECTION?: string;
  readonly VITE_POCKETBASE_USER_BUYERS_COLLECTION?: string;
  readonly VITE_POCKETBASE_BUYERS_COLLECTION?: string;
  readonly VITE_POCKETBASE_OUTLETS_COLLECTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
