/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dropbox app key (public; PKCE needs no secret). */
  readonly VITE_DROPBOX_APP_KEY?: string;
}
