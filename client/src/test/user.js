import { fireEvent } from '@testing-library/react';

/** Minimal stand-in for user-event (not a dependency of this project). */
const userEvent = {
  async click(el) {
    fireEvent.click(el);
  },
  async type(el, text) {
    fireEvent.change(el, { target: { value: text } });
  }
};

export default userEvent;
