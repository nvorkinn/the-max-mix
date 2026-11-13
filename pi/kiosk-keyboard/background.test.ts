import { describe, expect, it, vi } from 'vitest';
import { DATA_TYPES, forgetSignIns } from './background.ts';

describe('forgetSignIns', () => {
  it('clears cookies and storage of every site but the app', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    await forgetSignIns({ remove }, 'https://app.example');
    expect(remove).toHaveBeenCalledWith({ excludeOrigins: ['https://app.example'] }, DATA_TYPES);
    expect(DATA_TYPES.cookies).toBe(true);
  });
});
