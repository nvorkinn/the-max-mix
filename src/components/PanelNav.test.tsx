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

  it('fills the Lyrics button in while the lyrics are in sync mode', () => {
    const { rerender } = render(<PanelNav view="lyrics" onShow={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Lyrics' })).not.toHaveClass('is-syncing');
    rerender(<PanelNav view="lyrics" onShow={vi.fn()} lyricsSyncing />);
    expect(screen.getByRole('button', { name: 'Lyrics' })).toHaveClass('is-syncing');
  });

  it('turns the buttons into a blank, Cancel and Save, then Saving…, for a changed speaker choice', () => {
    const onShow = vi.fn();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const { container, rerender } = render(
      <PanelNav view="speakers" onShow={onShow} speakersButton="save" onSave={onSave} onCancel={onCancel} />
    );
    // Queue and Lyrics are gone, so the view is left only by saving or cancelling.
    for (const name of ['Speakers', 'Queue', 'Lyrics']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    const [blank] = container.querySelectorAll('button');
    expect(blank).toBeDisabled();
    expect(blank).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onShow).not.toHaveBeenCalled();

    rerender(<PanelNav view="speakers" onShow={onShow} speakersButton="saving" onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    // Confirmed: straight back to Speakers, with nothing saying "Saved".
    rerender(
      <PanelNav view="speakers" onShow={onShow} speakersButton="speakers" onSave={onSave} onCancel={onCancel} />
    );
    expect(screen.getByRole('button', { name: 'Speakers' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });
});
