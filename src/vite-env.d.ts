/** Build-time values that vite.config.ts defines, and the per-environment settings in .env.development and .env.production. */
interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  /** countdown-server's settings site, such as https://app.countdown.build: the kiosk's pairing QR code opens its /pair/add. */
  readonly VITE_COUNTDOWN_SERVER?: string;
  /** countdown-server's screens' API, such as https://api.countdown.build: the kiosk's config and its saves. */
  readonly VITE_COUNTDOWN_API?: string;
  /** `mock` gives the kiosk countdown-api's example config in place of the server's (src/countdown/config.ts). */
  readonly VITE_COUNTDOWN_CONFIG?: string;
}
