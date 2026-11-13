import { afterEach, describe, expect, it, vi } from 'vitest';

describe('sign-out relay', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('passes the app’s request to the extension and answers when it is done', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    vi.resetModules();
    await import('./sign-out.ts');
    const answered = new Promise<unknown>(resolve => {
      window.addEventListener('message', event => {
        const data: unknown = event.data;
        if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'maxmix:sign-ins-forgotten') {
          resolve(data);
        }
      });
    });
    const origin = location.origin;
    // Ignored: another window, another origin, another message.
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'maxmix:forget-sign-ins' }, origin }));
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'maxmix:forget-sign-ins' }, origin: 'https://x', source: window })
    );
    window.dispatchEvent(new MessageEvent('message', { data: 'maxmix:forget-sign-ins', origin, source: window }));
    expect(sendMessage).not.toHaveBeenCalled();

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'maxmix:forget-sign-ins' }, origin, source: window }));
    await answered;
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'maxmix:forget-sign-ins' });
  });
});
