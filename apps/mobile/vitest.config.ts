import { defineConfig } from "vitest/config";

// Unit tests cover the plain TypeScript in src/ (no React Native runtime needed).
export default defineConfig({ test: { include: ["src/**/*.test.ts"], environment: "node" } });
