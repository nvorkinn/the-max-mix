// ESLint only (formatting is handled elsewhere). Each package is linted with its own eslint binary;
// ESLint finds the nearest eslint.config.js from each file, so server/ and client/ use their own configs.
const lintPackage = (pkg) => (files) =>
  `npm --prefix ${pkg} exec --no -- eslint --max-warnings 0 --no-warn-ignored ${files.map((f) => JSON.stringify(f)).join(' ')}`;

module.exports = {
  'server/**/*.{js,jsx}': lintPackage('server'),
  'client/**/*.{js,jsx}': lintPackage('client'),
};
