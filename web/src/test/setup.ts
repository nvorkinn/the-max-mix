import { webcrypto } from 'node:crypto';
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { checkSpotifyRetryWindow, getSpotifyRetryAt } from '../spotify/http';

// jsdom's crypto has no SubtleCrypto (the sign-in hashes its PKCE verifier with it), so Node's stands in.
if (typeof crypto !== 'undefined' && !(crypto as Partial<Crypto>).subtle) {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
}

// jsdom lacks dialog lifecycle methods; real focus/inertness behavior is covered in Playwright.
if (typeof HTMLDialogElement !== 'undefined') {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
      }
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
      }
    }
  });
}

afterEach(() => {
  cleanup();
  const retryAt = getSpotifyRetryAt();
  if (retryAt > 0) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(retryAt);
    checkSpotifyRetryWindow();
    vi.useRealTimers();
  }
});
