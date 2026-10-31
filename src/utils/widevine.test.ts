import { describe, it, expect, vi, afterEach } from 'vitest';
import { widevineProblem } from './widevine';

const nav = navigator as { requestMediaKeySystemAccess?: unknown };

describe('widevineProblem', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete nav.requestMediaKeySystemAccess;
  });

  it('needs a secure page', async () => {
    vi.stubGlobal('isSecureContext', false);
    await expect(widevineProblem()).resolves.toMatch(/secure/);
  });

  it('reports a browser without encrypted media', async () => {
    vi.stubGlobal('isSecureContext', true);
    await expect(widevineProblem()).resolves.toMatch(/no encrypted media/);
  });

  it('is null when Widevine starts', async () => {
    vi.stubGlobal('isSecureContext', true);
    const createMediaKeys = vi.fn(() => Promise.resolve({}));
    nav.requestMediaKeySystemAccess = vi.fn(() => Promise.resolve({ createMediaKeys }));
    await expect(widevineProblem()).resolves.toBeNull();
    expect(nav.requestMediaKeySystemAccess).toHaveBeenCalledWith('com.widevine.alpha', expect.any(Array));
    expect(createMediaKeys).toHaveBeenCalled();
  });

  it('names the reason when Widevine is missing', async () => {
    vi.stubGlobal('isSecureContext', true);
    nav.requestMediaKeySystemAccess = vi.fn(() =>
      Promise.reject(new DOMException('Unsupported keySystem', 'NotSupportedError'))
    );
    await expect(widevineProblem()).resolves.toMatch(
      /Widevine is not available.*Unsupported keySystem.*libwidevinecdm0/
    );
  });
});
