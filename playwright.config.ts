import { defineConfig, devices } from "@playwright/test";

const SERVER_PORT = Number(process.env.HUMAN_LLM_SERVER_PORT ?? 8080);
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);
const BASE_URL = `http://localhost:${WEB_PORT}`;

// Boots the real Fastify server and the Vite dev server in parallel
// before any test runs. Vite is configured to proxy `/api` and `/v1`
// to the Fastify port (see packages/web/vite.config.ts).
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
  webServer: [
    {
      command: "npm run dev -w @human-llm/server",
      url: `http://localhost:${SERVER_PORT}/api/requests`,
      env: { PORT: String(SERVER_PORT), LOG_LEVEL: "warn" },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npm run dev -w @human-llm/web",
      url: BASE_URL,
      env: {
        WEB_PORT: String(WEB_PORT),
        HUMAN_LLM_SERVER_PORT: String(SERVER_PORT),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
