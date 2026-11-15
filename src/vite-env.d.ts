/** Build-time values that vite.config.ts defines, and the per-environment settings in .env.development and .env.production. */
interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  /** countdown-server's origin, such as https://countdown.build. */
  readonly VITE_COUNTDOWN_SERVER?: string;
}
