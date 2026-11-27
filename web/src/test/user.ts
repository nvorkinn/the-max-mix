import { fireEvent } from '@testing-library/react';

/** Minimal stand-in for user-event (not a dependency of this project). */
const userEvent = {
  click(el: Element | Window | Document) {
    fireEvent.click(el);
    return Promise.resolve();
  },
  type(el: Element | Window | Document, text: string) {
    fireEvent.change(el, { target: { value: text } });
    return Promise.resolve();
  }
};

export default userEvent;
