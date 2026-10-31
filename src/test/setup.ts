import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

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

afterEach(() => cleanup());
