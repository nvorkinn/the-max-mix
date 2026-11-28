import { afterEach, describe, expect, it, vi } from 'vitest';
import { brightnessOf, dimmedBrightness, quietDimmedBrightness, setBacklight } from './backlight';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('brightnessOf', () => {
  it("reads the display's setting", () => {
    expect(brightnessOf({ sleep_minutes: 5, brightness: 60 })).toBe(60);
  });

  it('is full for a display from before the setting, or with one out of range', () => {
    expect(brightnessOf({ sleep_minutes: 5 } as never)).toBe(100);
    expect(brightnessOf({ sleep_minutes: 5, brightness: 0 })).toBe(100);
    expect(brightnessOf({ sleep_minutes: 5, brightness: 250 })).toBe(100);
  });
});

describe('dimmedBrightness', () => {
  it('is a share of the setting, and never off', () => {
    expect(dimmedBrightness(100)).toBe(30);
    expect(dimmedBrightness(50)).toBe(15);
    expect(dimmedBrightness(1)).toBe(1);
  });
});

describe('quietDimmedBrightness', () => {
  it('is a smaller share of the setting, and never off', () => {
    expect(quietDimmedBrightness(100)).toBe(10);
    expect(quietDimmedBrightness(80)).toBe(8);
    expect(quietDimmedBrightness(10)).toBe(1);
  });
});

describe('setBacklight', () => {
  it('asks the kiosk for that percentage', () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetch);
    setBacklight(40);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:7341/display/brightness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"percent":40}'
    });
  });
});
