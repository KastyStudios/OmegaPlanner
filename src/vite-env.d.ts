/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dropbox app key (public; PKCE needs no secret). */
  readonly VITE_DROPBOX_APP_KEY?: string;
}

/** Origin of the OmegaPlanner Worker (push reminders), set in vite.config.ts. */
declare const __PUSH_SERVER__: string;
