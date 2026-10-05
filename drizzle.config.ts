import { defineConfig } from "drizzle-kit";
export default defineConfig({ dialect: "postgresql", schema: "./src/server/schema.ts", out: "./migrations/generated", dbCredentials: { url: process.env.DATABASE_URL || "postgresql://music:music@127.0.0.1:5432/music" } });
