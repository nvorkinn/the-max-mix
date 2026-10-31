export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let complete: (value: T | PromiseLike<T>) => void;
  // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- App test types target ES2023, not ES2024.
  const promise = new Promise<T>(resolve => {
    complete = resolve;
  });
  return { promise, resolve: (value: T) => complete(value) };
}
