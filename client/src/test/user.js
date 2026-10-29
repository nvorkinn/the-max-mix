import { fireEvent } from '@testing-library/react';

/** Minimal stand-in for user-event (not a dependency of this project). */
const userEvent = {
  /** @param {Element | Window | Document} el */
  click(el) {
    fireEvent.click(el);
    return Promise.resolve();
  },
  /**
   * @param {Element | Window | Document} el
   * @param {string} text
   */
  type(el, text) {
    fireEvent.change(el, { target: { value: text } });
    return Promise.resolve();
  }
};

export default userEvent;
