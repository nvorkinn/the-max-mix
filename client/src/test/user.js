import { fireEvent } from '@testing-library/react';

/** Minimal stand-in for user-event (not a dependency of this project). */
const userEvent = {
  /** @param {Element | Window | Document} el */
  async click(el) {
    fireEvent.click(el);
  },
  /**
   * @param {Element | Window | Document} el
   * @param {string} text
   */
  async type(el, text) {
    fireEvent.change(el, { target: { value: text } });
  }
};

export default userEvent;
