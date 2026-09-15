module.exports = {
  root: true,
  extends: [require.resolve("./packages/config/eslint.base.cjs")],
  ignorePatterns: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/drizzle/**"]
};
