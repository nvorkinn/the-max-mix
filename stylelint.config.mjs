// Stylelint for the Tailwind CSS 4 stylesheet(s) in src/. Prettier owns formatting, so this only holds the
// non-formatting rules of stylelint-config-standard (Stylelint 15+ ships no formatting rules of its own).
/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  rules: {
    // Tailwind 4 directives that are not standard CSS at-rules.
    'at-rule-no-unknown': [
      true,
      { ignoreAtRules: ['config', 'custom-variant', 'plugin', 'reference', 'source', 'theme', 'utility', 'variant'] }
    ],
    // Blank-line placement is layout, which Prettier leaves as written; requiring it here would only add churn.
    'at-rule-empty-line-before': null,
    'comment-empty-line-before': null,
    'declaration-empty-line-before': null,
    'rule-empty-line-before': null,
    // The component rules deliberately declare a base rule after its :hover/:active variants in places; reordering
    // them to satisfy this heuristic risks changing which declaration wins, so it is not enforced.
    'no-descending-specificity': null,
    // Tailwind documents `@import 'tailwindcss';` (a string), not the `url()` notation this rule would demand.
    'import-notation': 'string',
    // !important escalates specificity wars; the few justified uses carry a disable comment explaining why.
    'declaration-no-important': true,
    // Ids and long selector chains make rules hard to override and tie CSS to markup structure.
    'selector-max-id': 0,
    'selector-max-compound-selectors': 4,
    // Colours come from hex or the design tokens, never CSS keywords such as `red`.
    'color-named': 'never'
  }
};
