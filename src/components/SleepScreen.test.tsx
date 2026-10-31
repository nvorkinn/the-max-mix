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
});
