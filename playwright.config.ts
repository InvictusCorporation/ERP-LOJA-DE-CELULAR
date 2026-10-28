import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 1000 },
    headless: true,
    timezoneId: "America/Fortaleza",
  },
  webServer: {
    command:
      "node node_modules/typescript/bin/tsc -p tsconfig.server.json && node dist/scripts/dev.js",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  reporter: "list",
});
