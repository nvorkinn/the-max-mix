import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Artwork } from './TrackImages';

const log = vi.hoisted(() => vi.fn());
vi.mock('../utils/debugLog', () => ({ debugLog: log }));

describe('Artwork', () => {
  it('renders a bundled placeholder when there is no image URL', () => {
    render(<Artwork alt="Song album artwork" className="album-cover" />);
    expect(screen.getByRole('img', { name: 'Song album artwork unavailable' })).toHaveClass('image-placeholder');
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });

  it('replaces a failed image without requesting another URL and loads a new source', () => {
    const { rerender } = render(<Artwork src="/first.jpg" alt="Song album artwork" className="album-cover" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img', { name: 'Song album artwork unavailable' })).toHaveClass('image-placeholder');
    expect(document.querySelector('img')).not.toBeInTheDocument();
    expect(log).toHaveBeenCalledWith('warn', 'image', expect.stringContaining('showing a placeholder'));

    rerender(<Artwork src="/first.jpg" alt="Song album artwork" className="album-cover" />);
    expect(document.querySelector('img')).not.toBeInTheDocument();
    rerender(<Artwork src="/second.jpg" alt="Next album artwork" className="album-cover" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/second.jpg');
  });
});
