/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHANNEL_URL: string;
  readonly VITE_CHANNEL_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
