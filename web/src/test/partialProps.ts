import type { ComponentType } from 'react';

/**
 * Components infer their destructured props as required, but many tests deliberately render with only the props
 * that matter. This casts a component to accept any subset of its props; it does not change runtime behaviour.
 */
export function partialProps<P extends object>(component: ComponentType<P>): ComponentType<Partial<P>> {
  return component as unknown as ComponentType<Partial<P>>;
}
