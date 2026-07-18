/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly DATABASE_URL: string;
  readonly TOWN_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
