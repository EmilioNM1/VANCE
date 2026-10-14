import { defineConfig } from "@playwright/test";
import fs from "node:fs";

const port = Number(process.env.E2E_PORT ?? 3100);
const chromiumPath = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${port}`,
    locale: "es-ES",
    launchOptions: fs.existsSync(chromiumPath) ? { executablePath: chromiumPath } : {},
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 860 } }, testIgnore: /responsive\.spec\.ts/ },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next start -p ${port}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { RUN_WORKER_IN_WEB: "true" },
  },
});
