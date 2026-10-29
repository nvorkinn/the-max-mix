/** Narrows a possibly-missing value in a test, failing with a clear message instead of a TypeError later on. */
export function defined<T>(value: T | null | undefined, what = 'value'): T {
  if (value == null) throw new Error(`Expected ${what} to be defined`);
  return value;
}
