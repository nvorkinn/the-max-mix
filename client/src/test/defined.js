/**
 * Narrows a possibly-missing value in a test, failing with a clear message instead of a TypeError later on.
 * @template T
 * @param {T | null | undefined} value
 * @param {string} [what]
 * @returns {T}
 */
export function defined(value, what = 'value') {
  if (value == null) throw new Error(`Expected ${what} to be defined`);
  return value;
}
