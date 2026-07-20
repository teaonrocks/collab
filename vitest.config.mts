import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "convex/**/*.test.ts", "scripts/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "convex/**/*.ts", "scripts/**/*.mjs"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/test-support.{ts,tsx}",
        "convex/_generated/**",
        "src/test/**",
        "src/renderer/vite-env.d.ts"
      ],
      reporter: ["text", "html"]
    }
  }
})
