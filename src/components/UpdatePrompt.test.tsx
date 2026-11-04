import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import UpdatePrompt from './UpdatePrompt';

describe('UpdatePrompt', () => {
  it('names the newer version and offers to update now or not now', () => {
    const onUpdate = vi.fn();
    const onLater = vi.fn();
    render(<UpdatePrompt newer="v1.13.0 is out" onUpdate={onUpdate} onLater={onLater} />);
    expect(screen.getByRole('dialog', { name: 'Update available' })).toBeInTheDocument();
    expect(screen.getByText('v1.13.0 is out.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it('treats Escape like Not now', () => {
    const onLater = vi.fn();
    render(<UpdatePrompt newer="v1.13.0 is out" onUpdate={vi.fn()} onLater={onLater} />);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onLater).toHaveBeenCalledTimes(1);
  });
});
