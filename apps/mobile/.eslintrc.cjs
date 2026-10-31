// Standalone on purpose: the phone app is not part of the pnpm workspace, so it
// cannot load the shared config's plugins from the repo root. Rules match
// packages/config/eslint.base.cjs.
module.exports = {
  root: true,
  env: { es2022: true, node: true },
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "no-console": "off"
  },
  ignorePatterns: [".expo", "dist", "android", "ios", "node_modules", "expo-env.d.ts", "metro.config.js", ".eslintrc.cjs"]
};
