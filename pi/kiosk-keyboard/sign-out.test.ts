import { afterEach, describe, expect, it, vi } from 'vitest';

describe('sign-out relay', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('passes the app’s request to the extension and answers when it is done', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    vi.resetModules();
    await import('./sign-out.ts');
    const answered = new Promise<unknown>(resolve => {
      vi.spyOn(globalThis, 'postMessage').mockImplementation((message: unknown) => {
        resolve(message);
      });
    });
    const origin = location.origin;
    const page = globalThis as unknown as Window;
    // Ignored: another window, another origin, another message.
    globalThis.dispatchEvent(new MessageEvent('message', { data: { type: 'maxmix:forget-sign-ins' }, origin }));
    globalThis.dispatchEvent(
      new MessageEvent('message', { data: { type: 'maxmix:forget-sign-ins' }, origin: 'https://x', source: page })
    );
    globalThis.dispatchEvent(new MessageEvent('message', { data: 'maxmix:forget-sign-ins', origin, source: page }));
    expect(sendMessage).not.toHaveBeenCalled();

    globalThis.dispatchEvent(
      new MessageEvent('message', { data: { type: 'maxmix:forget-sign-ins' }, origin, source: page })
    );
    expect(await answered).toEqual({ type: 'maxmix:sign-ins-forgotten' });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'maxmix:forget-sign-ins' });
  });
});
