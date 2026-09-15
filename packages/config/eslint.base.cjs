/** Shared ESLint base config for all RIO GPS workspace packages. */
module.exports = {
  root: false,
  env: { es2022: true, node: true },
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "no-console": "off"
  },
  ignorePatterns: ["dist", ".next", "node_modules", "drizzle"]
};
