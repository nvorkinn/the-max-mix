import { afterEach, describe, expect, it, vi } from 'vitest';

// The button's host is the last element of the page.
function host(): Element | null {
  return document.documentElement.lastElementChild;
}

describe('back', () => {
  afterEach(() => {
    host()?.remove();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('draws a button that goes to the first page of the history, the app', async () => {
    const go = vi.spyOn(history, 'go').mockReturnValue();
    vi.spyOn(history, 'length', 'get').mockReturnValue(4);
    await import('./back.ts');

    const button = host()?.shadowRoot?.querySelector('button');
    expect(button?.textContent).toBe('← Back to THE MAX MIX');
    button?.click();
    expect(go).toHaveBeenCalledWith(-3);
  });
});
