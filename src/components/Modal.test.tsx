import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal from './Modal';

describe('Modal', () => {
  it('opens a named native dialog and closes it on unmount, including in Strict Mode', () => {
    const show = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close');
    const { unmount } = render(
      <StrictMode>
        <Modal labelledBy="title" onClose={vi.fn()} className="app-modal-panel">
          <h2 id="title">Settings</h2>
        </Modal>
      </StrictMode>
    );
    expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveAttribute('open');
    expect(show).toHaveBeenCalled();
    unmount();
    expect(close).toHaveBeenCalledTimes(show.mock.calls.length);
  });

  it('delegates native cancellation to the owner without independently closing the dialog', () => {
    const onClose = vi.fn();
    render(
      <Modal labelledBy="title" onClose={onClose} className="app-modal-panel">
        <h2 id="title">Settings</h2>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    const cancelled = !fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(cancelled).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveAttribute('open');
  });
});
