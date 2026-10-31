import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ENTRIES,
  captureBrowserErrors,
  clearDebugLog,
  debugLog,
  getDebugEntries,
  subscribeDebugLog
} from './debugLog';

describe('debugLog', () => {
  afterEach(() => clearDebugLog());

  it('records entries oldest first and tells subscribers', () => {
    const listener = vi.fn();
    const stop = subscribeDebugLog(listener);
    debugLog('info', 'sdk', 'ready', 1000);
    debugLog('error', 'player', 'boom', 2000);
    expect(getDebugEntries().map(entry => [entry.level, entry.source, entry.message, entry.time])).toEqual([
      ['info', 'sdk', 'ready', 1000],
      ['error', 'player', 'boom', 2000]
    ]);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    debugLog('info', 'sdk', 'again');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('counts a message repeated straight after itself instead of adding it again', () => {
    debugLog('error', 'queue', 'Slow down', 1000);
    debugLog('error', 'queue', 'Slow down', 5000);
    expect(getDebugEntries()).toEqual([expect.objectContaining({ count: 2, time: 1000, lastTime: 5000 })]);
    debugLog('error', 'player', 'Slow down', 6000);
    expect(getDebugEntries()).toHaveLength(2);
  });

  it('keeps only the newest entries', () => {
    for (let index = 0; index < MAX_ENTRIES + 5; index++) debugLog('info', 'test', `line ${index}`);
    const entries = getDebugEntries();
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(entries[0]?.message).toBe('line 5');
  });

  it('clears the log', () => {
    debugLog('info', 'test', 'x');
    clearDebugLog();
    expect(getDebugEntries()).toEqual([]);
  });

  it('copies console errors, warnings and uncaught errors while the console keeps working', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    captureBrowserErrors();
    captureBrowserErrors();
    console.error('bad', { code: 7 });
    console.warn('careful');
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = 'nope';
    window.dispatchEvent(rejection);
    expect(error).toHaveBeenCalledWith('bad', { code: 7 });
    expect(warn).toHaveBeenCalledWith('careful');
    expect(getDebugEntries().map(entry => [entry.level, entry.source, entry.message])).toEqual([
      ['error', 'console', 'bad {"code":7}'],
      ['warn', 'console', 'careful'],
      ['error', 'page', 'Script error.'],
      ['error', 'promise', 'nope']
    ]);
  });
});
