import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import MobileRemoteView from './MobileRemoteView.jsx';

describe('MobileRemoteView', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('aborts the initial queue fetch on unmount and ignores the AbortError', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let signal;
    const fetchMock = vi.fn((url, options) => {
      signal = options.signal;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(<MobileRemoteView socket={null} />);
    expect(fetchMock).toHaveBeenCalledWith('/api/queue', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
