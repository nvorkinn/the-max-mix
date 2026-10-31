import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Artwork, GuestAvatar } from './TrackImages';

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

describe('GuestAvatar', () => {
  it.each([
    ['Sarah', 'S'],
    ['  Sarah Jones  ', 'SJ'],
    ['Max Mix Guest', 'MM'],
    ['👩‍🎤 Singer', '👩‍🎤S'],
    ['', '?']
  ])('uses initials for %s without a network fallback', (name, initials) => {
    render(<GuestAvatar name={name} />);
    expect(screen.getByText(initials)).toHaveClass('guest-avatar', 'image-placeholder');
    expect(screen.getByText(initials)).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });

  it('uses initials after a failure and tries a changed theme image only once', () => {
    const { container, rerender } = render(<GuestAvatar src="/studio.jpg" name="Sarah Jones" />);
    const avatar = container.querySelector('img');
    expect(avatar).toBeInTheDocument();
    if (!avatar) throw new Error('Expected an avatar image');
    fireEvent.error(avatar);
    expect(screen.getByText('SJ')).toBeInTheDocument();
    rerender(<GuestAvatar src="/studio.jpg" name="Sarah Jones" />);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    rerender(<GuestAvatar src="/paper.jpg" name="Sarah Jones" />);
    const paperAvatar = container.querySelector('img');
    expect(paperAvatar).toHaveAttribute('src', '/paper.jpg');
    if (!paperAvatar) throw new Error('Expected the new avatar image');
    fireEvent.error(paperAvatar);
    expect(screen.getByText('SJ')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });
});
