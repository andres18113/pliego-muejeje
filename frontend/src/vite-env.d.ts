/// <reference types="vite/client" />

/** Stamped by vite.config.ts at build time (absent under Vitest). */
declare const __PLIEGO_BUILD_ID__: string | undefined;

interface ImportMetaEnv {
  /** Base URL (ending in "/") of the published responsive cover variants; unset keeps one URL per cover. */
  readonly VITE_COVER_VARIANTS_BASE?: string;
}
