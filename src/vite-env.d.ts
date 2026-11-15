/** Build-time values that vite.config.ts defines, and the per-environment settings in .env.development and .env.production. */
interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  /** countdown-server's origin, such as https://countdown.build. */
  readonly VITE_COUNTDOWN_SERVER?: string;
  /** `on` sends a kiosk with no device ID to the server's /register page at start. */
  readonly VITE_COUNTDOWN_REGISTRATION?: string;
  /** `mock` gives the kiosk countdown-api's example config in place of the server's (src/countdown/config.ts). */
  readonly VITE_COUNTDOWN_CONFIG?: string;
}
