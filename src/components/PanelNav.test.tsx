import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PanelNav from './PanelNav';

describe('PanelNav', () => {
  it('marks the view shown and asks for the one tapped', () => {
    const onShow = vi.fn();
    render(<PanelNav view="lyrics" onShow={onShow} />);
    expect(screen.getByRole('button', { name: 'Queue' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Lyrics' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Speakers' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    expect(onShow).toHaveBeenLastCalledWith('queue');
    fireEvent.click(screen.getByRole('button', { name: 'Speakers' }));
    expect(onShow).toHaveBeenLastCalledWith('speakers');
  });

  it('turns the Speakers button into Save, then Saving…, for a changed speaker choice', () => {
    const onShow = vi.fn();
    const onSave = vi.fn();
    const { rerender } = render(<PanelNav view="speakers" onShow={onShow} speakersButton="save" onSave={onSave} />);
    expect(screen.queryByRole('button', { name: 'Speakers' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onShow).not.toHaveBeenCalled();

    rerender(<PanelNav view="speakers" onShow={onShow} speakersButton="saving" onSave={onSave} />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    // Confirmed: straight back to Speakers, with nothing saying "Saved".
    rerender(<PanelNav view="speakers" onShow={onShow} speakersButton="speakers" onSave={onSave} />);
    expect(screen.getByRole('button', { name: 'Speakers' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });
});
