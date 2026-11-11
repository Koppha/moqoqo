/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the EcoCash Super App API, no trailing slash. Empty string = same origin. */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
