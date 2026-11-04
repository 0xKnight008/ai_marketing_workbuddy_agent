import { test, expect, type Page } from "@playwright/test";
import axe from "axe-core";
const text = "A product update for our X audience.";
async function setup(
  page: Page,
  options: {
    failSave?: boolean;
    lostStart?: boolean;
    expiredQuote?: boolean;
  } = {},
) {
  const state = {
    started: false,
    approved: false,
    rejected: false,
    published: false,
    failDecision: false,
    failSave: Boolean(options.failSave),
    quotes: [] as Record<string, unknown>[],
    activations: [] as Record<string, unknown>[],
    decisions: [] as Record<string, unknown>[],
    saves: 0,
  };
  let pipeline: Record<string, unknown> | null = null;
  const account = {
    id: "account-1",
    externalAccountId: "x-1",
    displayName: "Test X",
    platform: "x",
    status: "connected",
    capabilities: ["publish"],
  };
  const run = () => ({
    id: "run-1",
    workflowId: "pipeline-1",
    status: state.published
      ? "succeeded"
      : state.rejected
        ? "cancelled"
        : state.approved
          ? "running"
          : "waiting_approval",
    createdAt: "2026-11-03",
    modelBand: "eco",
    drafts: [{ platform: "x", content: text, hashtags: [] }],
  });
  const approval = {
    id: "approval-1",
    runId: "run-1",
    requestedAt: "2026-11-03",
    requestedAction: {
      summary: "Publish launch draft",
      actions: [
        {
          type: "social.create_post",
          accountId: "x-1",
          platform: "x",
          mode: "publish_now",
          content: text,
          hashtags: ["#launch"],
        },
      ],
    },
  };
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "piggybot.ownerAccessToken",
      `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`,
    ),
  );
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          user: { email: "test@example.invalid", passwordSet: true },
          workspace: { id: "workspace-1", name: "Test" },
          role: "owner",
          plan: "growth",
          subscriptionStatus: "active",
        },
      });
    if (path === "/api/billing/usage")
      return route.fulfill({
        json: {
          status: "normal",
          subscriptionStatus: "active",
          aiCreditsAvailable: 100,
          aiCreditsUsed: 0,
          taskQuota: 1000,
          taskUsed: 0,
          plan: "growth",
        },
      });
    if (path === "/api/pipeline-templates")
      return route.fulfill({
        json: [
          {
            id: "repurpose",
            name: "Repurpose and publish",
            description: "Prepare an announcement",
            available: true,
          },
        ],
      });
    if (path === "/api/zernio/accounts")
      return route.fulfill({ json: [account] });
    if (path === "/api/pipelines" && req.method() === "GET")
      return route.fulfill({ json: pipeline ? [pipeline] : [] });
    if (
      (path === "/api/pipelines" && req.method() === "POST") ||
      (path === "/api/pipelines/pipeline-1" && req.method() === "PATCH")
    ) {
      state.saves++;
      if (state.failSave)
        return route.fulfill({ status: 500, json: { error: "save_failed" } });
      const body = req.postDataJSON();
      pipeline = {
        id: "pipeline-1",
        name: body.name,
        version: state.saves,
        status: "draft",
        definition: { ...body.configuration, source: body.source },
      };
      return route.fulfill({ json: pipeline });
    }
    if (path.endsWith("/test"))
      return route.fulfill({ json: { ready: true, checks: [] } });
    if (path === "/api/billing/ai-quote") {
      expect(req.headers()["content-type"]).toContain("application/json");
      state.quotes.push(req.postDataJSON());
      return route.fulfill({
        json: {
          mode: "cost-v1",
          policyVersion: "cost-106-v1",
          quoteId: "quote-1",
          estimatedCredits: 27,
          maxCredits: req.postDataJSON().maxCredits ?? 30,
          expiresAt: new Date(
            Date.now() +
              (options.expiredQuote && state.quotes.length === 1
                ? -60000
                : 600000),
          ).toISOString(),
        },
      });
    }
    if (path.endsWith("/activate")) {
      expect(req.headers()["content-type"]).toContain("application/json");
      state.activations.push(req.postDataJSON());
      state.started = true;
      pipeline = {
        ...pipeline,
        status: "published",
        lastRunId: "run-1",
        lastRunStatus: "waiting_approval",
      };
      if (options.lostStart) return route.abort();
      return route.fulfill({
        json: { ...pipeline, run: { ...run(), status: "queued" } },
      });
    }
    if (path === "/api/runs/run-1") return route.fulfill({ json: run() });
    if (path === "/api/approval-requests")
      return route.fulfill({
        json:
          state.started && !state.approved && !state.rejected ? [approval] : [],
      });
    if (path.startsWith("/api/approval-requests/")) {
      state.decisions.push({ path, ...req.postDataJSON() });
      if (state.failDecision)
        return route.fulfill({ status: 503, json: { error: "unavailable" } });
      state.approved = path.endsWith("/approved");
      state.rejected = !state.approved;
      return route.fulfill({
        json: { status: state.approved ? "approved" : "rejected" },
      });
    }
    if (path === "/api/model-executions/workflow/run-1")
      return route.fulfill({
        json: [
          {
            step: 1,
            band: "eco",
            credits: 27,
            costReceipt: {
              id: "quote-1",
              band: "eco",
              state: "settled",
              maxCredits: 30,
              heldCredits: 0,
              settledCredits: 27,
              releasedCredits: 3,
              actualModels: ["fixture"],
            },
          },
        ],
      });
    if (path === "/api/topics")
      return route.fulfill({ json: { run: null, topics: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/app#pipelines");
  await page.getByRole("button", { name: "New pipeline", exact: true }).click();
  await page.getByLabel("Pipeline name", { exact: true }).fill("Launch");
  await page
    .getByLabel("Source material", { exact: true })
    .fill("We added source evidence to customer feedback insights.");
  await page
    .getByLabel("What should this post achieve?", { exact: true })
    .fill("Prepare a concise X post for creators.");
  await page.getByRole("checkbox", { name: /Test X/ }).check();
  return state;
}
async function budget(page: Page) {
  await page
    .getByRole("button", { name: "Review estimated credits", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Confirm credits & generate",
      exact: true,
    }),
  ).toBeVisible();
}
async function start(page: Page) {
  await budget(page);
  await page
    .getByRole("button", { name: "Confirm credits & generate", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Publish launch draft", exact: true }),
  ).toBeVisible();
}

test("X pipeline confirms credits, reviews and publishes on the same page, and reopens without another charge", async ({
  page,
}, testInfo) => {
  const state = await setup(page);
  await start(page);
  await expect(page).toHaveURL(/#pipelines\/pipeline-1$/);
  expect(state.activations).toEqual([
    { modelBand: "eco", aiQuoteId: "quote-1" },
  ]);
  await expect(page.locator(".pipeline-post pre")).toHaveText(
    text + " #launch",
  );
  await page.screenshot({
    path: testInfo.outputPath("pipeline-review.png"),
    fullPage: true,
  });
  await expect(page.locator(".pipeline-post")).toContainText("Test X");
  const approve = page.getByRole("button", {
    name: "Approve & publish",
    exact: true,
  });
  await expect(approve).toBeDisabled();
  await page.getByLabel("I checked the copy and destination accounts").check();
  await approve.click();
  expect(state.decisions).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirm decision", exact: true })
    .click();
  await expect.poll(() => state.approved).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Published successfully", exact: true }),
  ).toHaveCount(0);
  state.published = true;
  await page
    .getByRole("button", { name: "Refresh status", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Published successfully", exact: true }),
  ).toBeVisible();
  expect(state.decisions).toHaveLength(1);
  expect(state.quotes).toHaveLength(1);
  await page.reload();
  await expect(page.locator(".workspace-shell")).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole("heading", { name: "Published successfully", exact: true }),
  ).toBeVisible();
  expect(state.activations).toHaveLength(1);
  expect(state.quotes).toHaveLength(1);
});
test("cancelled budget does not start, and save errors preserve source and goal", async ({
  page,
}) => {
  const state = await setup(page, { failSave: true });
  await page
    .getByRole("button", { name: "Review estimated credits", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Your input is preserved",
  );
  await expect(page.getByLabel("Source material", { exact: true })).toHaveValue(
    /source evidence/,
  );
  expect(state.activations).toHaveLength(0);
  state.failSave = false;
  await budget(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.activations).toHaveLength(0);
  await expect(
    page.getByLabel("What should this post achieve?", { exact: true }),
  ).toHaveValue("Prepare a concise X post for creators.");
});
test("a lost start response recovers the existing run without quoting or generating again", async ({
  page,
}) => {
  const state = await setup(page, { lostStart: true });
  await budget(page);
  await page
    .getByRole("button", { name: "Confirm credits & generate", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Check status and continue",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check status and continue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Publish launch draft", exact: true }),
  ).toBeVisible();
  expect(state.activations).toHaveLength(1);
  expect(state.quotes).toHaveLength(1);
});
test("expired or edited budget needs fresh confirmation before starting", async ({
  page,
}) => {
  const state = await setup(page, { expiredQuote: true });
  await budget(page);
  await page
    .getByRole("button", { name: "Confirm credits & generate", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Budget refreshed");
  expect(state.activations).toHaveLength(0);
  expect(state.quotes).toHaveLength(2);
  await page
    .getByRole("button", { name: "Confirm credits & generate", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Publish launch draft", exact: true }),
  ).toBeVisible();
  expect(state.activations).toHaveLength(1);
});
test("failed inline rejection preserves its note; confirmed rejection never publishes", async ({
  page,
}) => {
  const state = await setup(page);
  await start(page);
  state.failDecision = true;
  await page
    .getByRole("button", { name: "Do not publish yet", exact: true })
    .click();
  await page
    .getByLabel("Decision note (optional)")
    .fill("Needs a clearer example");
  await page
    .getByRole("button", { name: "Confirm decision", exact: true })
    .click();
  await expect(page.locator(".pipeline-confirm [role=alert]")).toBeVisible();
  await expect(page.getByLabel("Decision note (optional)")).toHaveValue(
    "Needs a clearer example",
  );
  state.failDecision = false;
  await page
    .getByRole("button", { name: "Confirm decision", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Not published · result retained",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.approved).toBe(false);
  expect(state.decisions[1]).toMatchObject({
    reason: "Needs a clearer example",
    path: "/api/approval-requests/approval-1/rejected",
  });
});
for (const locale of ["en", "zh", "es"])
  test(`${locale}: inline credits and left navigation fit mobile and remain accessible`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await setup(page);
    await budget(page);
    await page.locator("#workspace-language").selectOption(locale);
    await expect(page.locator(".pipeline-budget")).not.toContainText(
      /1[.,]06|0[.,]01|cost-106/,
    );
    await expect(page.locator(".pipeline-estimate")).toContainText("27");
    expect(state.activations).toHaveLength(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const sidebar = await page.locator(".workspace-sidebar").boundingBox(),
      main = await page.locator(".workspace-main").boundingBox();
    expect(sidebar!.x).toBe(0);
    expect(main!.x).toBeGreaterThanOrEqual(sidebar!.width);
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () =>
      (window as unknown as { axe: typeof axe }).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      }),
    );
    expect(violations.violations).toEqual([]);
  });

test("sidebar collapse preserves the goal and persists on desktop reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page);
  await page
    .getByRole("button", { name: "Collapse navigation", exact: true })
    .click();
  await expect(page.locator(".workspace-shell")).toHaveClass(/sidebar-compact/);
  await expect(
    page.getByLabel("What should this post achieve?", { exact: true }),
  ).toHaveValue("Prepare a concise X post for creators.");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expand navigation", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".workspace-shell")).toHaveClass(/sidebar-compact/);
});
test("requesting changes rejects the reviewed version before preparing a new budget", async ({
  page,
}) => {
  const state = await setup(page);
  await start(page);
  await page
    .getByRole("button", { name: "Request changes", exact: true })
    .click();
  expect(state.decisions).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirm decision", exact: true })
    .click();
  await expect(page.getByLabel("Source material", { exact: true })).toHaveValue(
    /source evidence/,
  );
  expect(state.rejected).toBe(true);
  expect(state.approved).toBe(false);
  expect(state.activations).toHaveLength(1);
  expect(state.quotes).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Review estimated credits", exact: true }),
  ).toBeVisible();
});

for (const [locale, heading, explanation] of [
  ['en', 'Confirm more credits to continue', 'Nothing has been published.'],
  ['zh', '请确认更多额度后继续', '尚未发布任何内容'],
  ['es', 'Confirma más créditos para continuar', 'No se publicó nada.'],
]) test(`Pipeline budget pause is explained without approval or publishing (${locale})`, async ({ page }) => {
  const state = await setup(page);
  await page.route('**/api/runs/run-1', route => route.fulfill({ json: { id: 'run-1', status: 'queued', modelBand: 'eco', failure: { kind: 'budget_exhausted', issues: [] } } }));
  await page.route('**/api/approval-requests', route => route.fulfill({ json: [] }));
  await budget(page);
  await page.getByRole('button', { name: 'Confirm credits & generate', exact: true }).click();
  await expect(page).toHaveURL(/#pipelines\/pipeline-1$/);
  await page.goto(`/app?locale=${locale}#pipelines/pipeline-1`);
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(explanation!);
  expect(state.decisions).toHaveLength(0);
  expect(state.published).toBe(false);
  expect(state.activations).toHaveLength(1);
});
