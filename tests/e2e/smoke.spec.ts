import { expect, test } from "@playwright/test";

// Smoke test: confirms the Playwright + webServer wiring works.
// Real flow tests (claim a request, type a reply, assert SSE chunks
// reach the API client) land alongside the feature implementation —
// see docs/testing.md.

test("home page renders the placeholder shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "human-llm" })).toBeVisible();
  await expect(page.getByTestId("status")).toHaveText("No requests pending.");
});
