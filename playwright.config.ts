import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.WEB_PORT ?? 5173);
const BASE_URL = `http://localhost:${PORT}`;

// In a follow-up issue, replace `webServer` with concurrent runs of
// the real Fastify server and the Vite dev server. For now we serve
// the placeholder packages/web/index.html via a tiny static server so
// the e2e infra is fully wired and exercised by the smoke test.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: process.env.CI ? "dot" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `node tools/static-server.mjs packages/web ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
