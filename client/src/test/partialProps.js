/**
 * Components infer their destructured props as required, but many tests deliberately render with only the props
 * that matter. This casts a component to accept any subset of its props; it does not change runtime behaviour.
 * @template {import('react').ComponentType<never>} C
 * @param {C} component
 * @returns {import('react').ComponentType<Partial<import('react').ComponentProps<C>>>}
 */
export function partialProps(component) {
  return /** @type {import('react').ComponentType<Partial<import('react').ComponentProps<C>>>} */ (
    /** @type {unknown} */ (component)
  );
}
