import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SleepScreen from './SleepScreen';

describe('SleepScreen', () => {
  it('wakes on a tap and keeps the tap from the page behind it', () => {
    const onWake = vi.fn();
    const behind = vi.fn();
    document.addEventListener('click', behind);
    render(<SleepScreen onWake={onWake} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wake the screen' }));
    document.removeEventListener('click', behind);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(behind).not.toHaveBeenCalled();
  });

  it('darkens the page to dim a panel with no backlight, and leaves a backlit one clear', () => {
    const { rerender } = render(<SleepScreen dimmed onWake={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Dimmed screen' });
    expect(dialog).toHaveClass('sleep-screen-dimmed');
    rerender(<SleepScreen dimmed backlit onWake={vi.fn()} />);
    expect(dialog).toHaveClass('sleep-screen-clear');
    expect(dialog).not.toHaveClass('sleep-screen-dimmed');
    // Asleep is black on any panel.
    rerender(<SleepScreen backlit onWake={vi.fn()} />);
    expect(dialog).toHaveClass('sleep-screen', { exact: true });
  });
});
