/** Build-time values that vite.config.ts defines, and the per-environment settings in .env.development and .env.production. */
interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  /** countdown-server's origin, such as https://countdown.build. */
  readonly VITE_COUNTDOWN_SERVER?: string;
  /** `on` sends a kiosk with no device ID to the server's /register page at start. */
  readonly VITE_COUNTDOWN_REGISTRATION?: string;
  /** `on` shows the server's config site inside the Settings tab, once the site's embedded mode is live. */
  readonly VITE_COUNTDOWN_EMBED?: string;
}
