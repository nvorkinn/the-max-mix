import { describe, expect, it } from 'vitest';
import { errorMessage } from './errorMessage';

describe('errorMessage', () => {
  it('reads the message of an Error', () => {
    expect(errorMessage(new TypeError('boom'))).toBe('boom');
  });

  it('turns anything else that was thrown into text', () => {
    expect(errorMessage('plain text')).toBe('plain text');
    expect(errorMessage(404)).toBe('404');
  });
});
