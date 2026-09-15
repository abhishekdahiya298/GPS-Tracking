import { defineConfig } from "drizzle-kit";

if (!process.env.RIO_DATABASE_URL) {
  throw new Error("RIO_DATABASE_URL must be set (see .env.example) before running drizzle-kit.");
}

export default defineConfig({
  schema: "./src/schema/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.RIO_DATABASE_URL
  },
  strict: true,
  verbose: true
});
