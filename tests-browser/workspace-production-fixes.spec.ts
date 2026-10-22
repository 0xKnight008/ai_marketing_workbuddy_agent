import { test, expect, type Page } from "@playwright/test";
import axe from "axe-core";
const workspace = "44444444-4444-4444-8444-444444444444",
  taskId = "11111111-1111-4111-8111-111111111111",
  jobId = "22222222-2222-4222-8222-222222222222",
  batchId = "55555555-5555-4555-8555-555555555555";
function initial() {
  return {
    pending: true,
    trial: false,
    reason: "credits",
    failed: false,
    paused: false,
    viewer: false,
    awaitingModel: true,
    available: 7,
    choices: ["eco", "standard"],
    requests: [] as any[],
    task: {
      id: taskId,
      goal: "Review onboarding",
      sourceKind: "conversation",
      sourceId: null,
      modelBand: "flagship",
      status: "completed",
      version: 2,
      batchIds: [batchId],
      archivedAt: null,
    },
    messages: [
      {
        id: "user-message",
        role: "user",
        content: "Review onboarding",
        status: "completed",
        modelBand: "flagship",
        citations: [],
      },
      {
        id: "assistant-message",
        role: "assistant",
        content: "A welcome draft",
        status: "completed",
        modelBand: "flagship",
        executions: [
          { step: 1, band: "flagship", credits: 20, provider: "primary" },
          { step: 2, band: "eco", credits: 1, provider: "primary" },
        ],
        citations: [],
      },
    ],
  };
}
async function setup(page: Page, s: ReturnType<typeof initial>) {
  page.on("pageerror", (e) => {
    throw e;
  });
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "piggybot.ownerAccessToken",
      `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`,
    ),
  );
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      body = req.method() === "GET" ? null : req.postDataJSON();
    if (body) s.requests.push({ path, body });
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          user: { email: "test@example.invalid", passwordSet: true },
          workspace: { id: workspace, name: "Production fixes" },
          role: s.viewer ? "viewer" : "owner",
          plan: "growth",
          subscriptionStatus: s.trial ? "trialing" : "active",
          trialConversionAvailable: s.trial,
        },
      });
    if (path === "/api/billing/usage")
      return route.fulfill({
        json: {
          status: s.paused ? "paused" : "normal",
          subscriptionStatus: s.trial ? "trialing" : "active",
          trialConversionAvailable: s.trial,
          taskUsed: 1,
          taskQuota: 100,
          aiCreditsAvailable: s.available,
          plan: "growth",
        },
      });
    if (path === "/api/billing/dashboard")
      return route.fulfill({
        json: {
          usage: {
            status: s.paused ? "paused" : "normal",
            subscriptionStatus: s.trial ? "trialing" : "active",
          trialConversionAvailable: s.trial,
            taskUsed: 1,
            taskQuota: 100,
            aiCreditsAvailable: s.available,
            plan: "growth",
          },
          subscription: null,
          syncError: false,
          creditBalance: 0,
          refundDebt: 0,
          includedCredits: 100,
          canManage: true,
          canUpgrade: true,
          canTopup: true,
          topups: [],
        },
      });
    if (path === "/api/model-choices")
      return route.fulfill({
        json: s.awaitingModel
          ? [
              {
                id: jobId,
                kind: "task.turn",
                taskId,
                requestedBand: "flagship",
                reason: s.reason,
                availableCredits: s.available,
                choices: s.choices,
              },
            ]
          : [],
      });
    if (path === `/api/model-choices/${jobId}`) {
      if (s.failed) {
        s.failed = false;
        s.available = 1;
        s.choices = ["eco"];
        return route.fulfill({
          status: 409,
          json: { error: "model_choice_unavailable" },
        });
      }
      s.awaitingModel = false;
      return route.fulfill({ json: { id: jobId, modelBand: body.modelBand } });
    }
    if (path === "/api/approval-requests")
      return route.fulfill({
        json: s.pending
          ? [
              {
                id: jobId,
                runId: taskId,
                requestedAt: new Date().toISOString(),
                requestedAction: {
                  summary: "Publish exact draft",
                  parameters: {
                    content: "Original draft",
                    targetLabel: "Test channel",
                  },
                },
              },
            ]
          : [],
      });
    if (path.startsWith("/api/approval-requests/")) {
      if (s.failed) {
        s.failed = false;
        return route.fulfill({ status: 503, json: { error: "unavailable" } });
      }
      s.pending = false;
      return route.fulfill({
        json: {
          runId: taskId,
          status: path.endsWith("approved") ? "queued" : "cancelled",
        },
      });
    }
    if (path === "/api/task-preferences")
      return route.fulfill({
        json: {
          persona: "creators",
          modelBand: "standard",
          language: "en",
          goal: "",
        },
      });
    if (path === "/api/tasks" && body) {
      s.task = {
        ...s.task,
        ...body,
        id: body.requestId,
        status: "ready",
        version: 0,
      };
      s.messages = [];
      return route.fulfill({ json: s.task });
    }
    if (path === `/api/tasks/${s.task.id}/messages`) {
      s.task.status = "completed";
      s.messages = [
        {
          id: "u",
          role: "user",
          content: body.message,
          status: "completed",
          modelBand: body.modelBand,
          citations: [],
        },
        {
          id: "a",
          role: "assistant",
          content: "Saved answer",
          status: "completed",
          modelBand: body.modelBand,
          executions: [
            { step: 1, band: body.modelBand, provider: "primary", credits: 6 },
          ],
          citations: [],
        },
      ];
      return route.fulfill({ json: { messageId: "a", version: 2 } });
    }
    if (path === `/api/tasks/${s.task.id}`)
      return route.fulfill({ json: { task: s.task, messages: s.messages } });
    if (path === "/api/imports")
      return route.fulfill(
        body
          ? { json: { id: batchId, status: "pending" } }
          : {
              json: [
                {
                  id: batchId,
                  label: "Selected source",
                  sourceType: "paste",
                  status: "classified",
                  itemCount: 1,
                  modelBand: "eco",
                  createdAt: "2026-10-22",
                  tagDistribution: {},
                },
              ],
            },
      );
    if (path === "/api/topics")
      return route.fulfill({ json: { run: null, topics: [] } });
    return route.fulfill({ json: [] });
  });
}
test("model choice waits for confirmation, cancellation writes nothing, and confirmed model is explicit", async ({
  page,
}) => {
  const s = initial();
  await setup(page, s);
  await page.goto(`/app#start/task/${taskId}`);
  const queue = page.getByRole("region", { name: "Model confirmation" }); // section has an accessible name
  await expect(queue).toBeVisible();
  expect(s.requests).toHaveLength(0);
  await queue
    .getByRole("button", { name: "Review model choice", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Keep waiting" })
    .click();
  expect(s.requests).toHaveLength(0);
  await queue
    .getByRole("button", { name: "Review model choice", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Available model")
    .selectOption("standard");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm model & continue" })
    .click();
  await expect(queue).not.toBeVisible();
  expect(s.requests[0]).toMatchObject({
    path: `/api/model-choices/${jobId}`,
    body: { modelBand: "standard" },
  });
  await expect(page.locator(".model-execution")).toContainText(
    "Actual execution: Flagship / Eco",
  );
  await expect(page.locator(".model-execution")).toContainText("21 AI credits");
});
test("a changed balance refreshes the confirmation choices and preserves the failure message", async ({
  page,
}) => {
  const s = initial();
  s.failed = true;
  await setup(page, s);
  await page.goto("/app");
  await page
    .getByRole("button", { name: "Review model choice", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Available model").selectOption("standard");
  await dialog
    .getByRole("button", { name: "Confirm model & continue" })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Available model")).toHaveValue("eco");
  await expect(dialog.locator("option")).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "Confirm model & continue" })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(s.requests.map((r) => r.body.modelBand)).toEqual(["standard", "eco"]);
});
for (const decision of ["Approve", "Reject"])
  test(`${decision} keeps failure visible, retries safely, and persists after reload even when billing is paused`, async ({
    page,
  }) => {
    const s = initial();
    s.awaitingModel = false;
    s.failed = true;
    s.paused = true;
    await setup(page, s);
    await page.goto("/app#review");
    await page.getByRole("button", { name: decision, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Decision note (optional)")
      .fill("Checked original draft");
    await dialog.getByRole("button", { name: "Confirm decision" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByRole("textbox")).toHaveValue(
      "Checked original draft",
    );
    await dialog.getByRole("button", { name: "Confirm decision" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByText("All caught up", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("All caught up", { exact: true }),
    ).toBeVisible();
    expect(s.requests).toHaveLength(2);
    expect(s.requests[0]).toEqual(s.requests[1]);
    expect(s.requests[0].body.reason).toBe("Checked original draft");
  });
test("canonical navigation removes old toolbars and retains source, topic, weekly and reminder capabilities", async ({
  page,
}) => {
  const s = initial();
  s.awaitingModel = false;
  await setup(page, s);
  await page.goto("/app");
  await expect(page.locator(".workspace-sidebar nav button")).toHaveCount(7);
  await expect(page.getByText("More tools", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Source library", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Source library", exact: true }),
  ).toBeVisible();
  await page
    .getByText("Import Discord messages", { exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Discord channel ID")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View source", exact: true }),
  ).toBeVisible();
  await page.locator("[data-nav=reports]").click();
  await expect(
    page.getByRole("tab", { name: "Topics", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Topics", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Topic clustering" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Weekly review", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Weekly follow-up review" }),
  ).toBeVisible();
  await page.locator("[data-nav=settings]").click();
  await page
    .getByRole("tab", { name: "Digests & reminders", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Scheduled delivery", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("More tools", { exact: true })).toHaveCount(0);
});
for (const hash of [
  "dashboard",
  "imports",
  "topics",
  "notifications",
  "billing",
])
  test(`legacy #${hash} resolves into a canonical page`, async ({ page }) => {
    const s = initial();
    s.awaitingModel = false;
    await setup(page, s);
    await page.goto(`/app#${hash}`);
    const expected = {
      dashboard: "start",
      imports: "start",
      topics: "reports",
      notifications: "settings",
      billing: "settings",
    }[hash];
    await expect(page.locator(`[data-nav=${expected}]`)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.getByText("More tools", { exact: true })).toHaveCount(0);
  });
for (const locale of ["en", "zh", "es"])
  test(`${locale}: model choice fits mobile and remains accessible`, async ({
    page,
  }) => {
    const s = initial();
    await setup(page, s);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/app#start/task/${taskId}`);
    await page.locator("#workspace-language").selectOption(locale);
    await expect(page.locator(".model-choice-queue")).toBeVisible();
    await page.locator(".model-choice-queue button").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: `/tmp/piggy-model-choice-${locale}.png` });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.addScriptTag({ content: axe.source });
    const a11y = await page.evaluate(
      async () =>
        await (window as any).axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        }),
    );
    expect(a11y.violations).toEqual([]);
  });
test("CSV import stays in the new task, preserves the custom name and rejects oversized files", async ({
  page,
}) => {
  const s = initial();
  s.awaitingModel = false;
  await setup(page, s);
  await page.goto("/app");
  await page.getByLabel("Source type", { exact: true }).selectOption("csv");
  await page
    .getByLabel("Source name", { exact: true })
    .fill("Custom source name");
  const file = page.locator("input[type=file]");
  await file.setInputFiles({
    name: "large.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, "x"),
  });
  await expect(page.getByRole("alert")).toContainText("under 2 MiB");
  expect(s.requests).toHaveLength(0);
  await file.setInputFiles({
    name: "source.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("text\nOriginal feedback"),
  });
  await page.getByRole("button", { name: "Confirm the goal →" }).click();
  await page
    .getByLabel("Task goal", { exact: true })
    .fill("Summarize feedback");
  await page
    .getByRole("button", { name: "Run this task", exact: true })
    .click();
  await expect
    .poll(() => s.requests.some((r) => r.path === "/api/imports"))
    .toBeTruthy();
  expect(s.requests.find((r) => r.path === "/api/imports").body).toMatchObject({
    label: "Custom source name",
    sourceType: "csv",
    content: "text\nOriginal feedback",
  });
});

test("Discord source errors preserve the label and channel without creating duplicate imports", async ({
  page,
}) => {
  const s = initial();
  s.awaitingModel = false;
  await setup(page, s);
  await page.route("**/api/imports", async (route) => {
    if (route.request().method() === "POST") {
      s.requests.push({
        path: "/api/imports",
        body: route.request().postDataJSON(),
      });
      return route.fulfill({
        status: 409,
        json: { error: "discord_import_no_new_messages" },
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/app#imports");
  await page
    .locator("main summary")
    .filter({ hasText: "Import Discord messages" })
    .click();
  await page
    .getByLabel("Source name", { exact: true })
    .last()
    .fill("Community snapshot");
  await page.getByLabel("Discord channel ID").fill("123456789012345678");
  await page
    .getByRole("button", { name: "Import Discord messages", exact: true })
    .click();
  await expect(
    page.getByText(/No new Discord messages in the latest/),
  ).toBeVisible();
  await expect(
    page.getByLabel("Source name", { exact: true }).last(),
  ).toHaveValue("Community snapshot");
  await expect(page.getByLabel("Discord channel ID")).toHaveValue(
    "123456789012345678",
  );
  expect(s.requests[0].body).toMatchObject({
    label: "Community snapshot",
    sourceType: "discord",
    channelId: "123456789012345678",
  });
  expect(s.requests).toHaveLength(1);
});
test("the consolidated templates retain all six choices and can queue daily operations", async ({
  page,
}) => {
  const s = initial();
  s.awaitingModel = false;
  await setup(page, s);
  await page.route("**/api/imports", async (route) =>
    route.fulfill({
      json:
        route.request().method() === "POST"
          ? {
              id: batchId,
              label: "Template source",
              status: "classified",
              itemCount: 1,
            }
          : [],
    }),
  );
  await page.route("**/api/insights", async (route) => {
    if (route.request().method() === "POST") {
      s.requests.push({
        path: "/api/insights",
        body: route.request().postDataJSON(),
      });
      return route.fulfill({
        json: {
          id: jobId,
          template: "daily_ops",
          status: "pending",
          batchIds: [batchId],
          itemCount: 1,
          report: null,
        },
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/app?mode=template#start");
  await page.getByLabel("Source name", { exact: true }).fill("Template source");
  await page.getByLabel("Date / scope", { exact: true }).fill("Today");
  await page
    .getByLabel("One item per line", { exact: true })
    .fill("Please explain onboarding.");
  await page
    .getByRole("button", { name: "Preview scope →", exact: true })
    .click();
  const templates = page.getByRole("combobox", {
    name: "Report template",
    exact: true,
  });
  await expect(templates).toBeVisible();
  expect(
    await templates
      .locator("option")
      .evaluateAll((options) =>
        options.map((o) => (o as HTMLOptionElement).value),
      ),
  ).toEqual([
    "content_recap",
    "comment_insights",
    "product_opportunities",
    "review_attribution",
    "community_digest",
    "daily_ops",
  ]);
  await templates.selectOption("daily_ops");
  await page
    .getByRole("button", { name: /Confirm goal & run analysis/ })
    .click();
  await expect
    .poll(() => s.requests.some((r) => r.path === "/api/insights"))
    .toBeTruthy();
  expect(s.requests.find((r) => r.path === "/api/insights").body.template).toBe(
    "daily_ops",
  );
});
test("output language stays independent from interface language in the canonical goal flow", async ({
  page,
}) => {
  const s = initial();
  s.awaitingModel = false;
  await setup(page, s);
  await page.goto("/app");
  await page
    .getByLabel("Source type", { exact: true })
    .selectOption("existing");
  await page.getByLabel("Selected source", { exact: true }).check();
  await page.getByRole("button", { name: "Confirm the goal →" }).click();
  await page
    .getByLabel("Task goal", { exact: true })
    .fill("Summarize the selected feedback");
  await page
    .getByRole("combobox", { name: "Output language", exact: true })
    .selectOption("es");
  await page.locator("#workspace-language").selectOption("zh");
  await expect(
    page.getByRole("combobox", { name: "结果语言", exact: true }),
  ).toHaveValue("es");
  await page.getByRole("button", { name: "开始任务", exact: true }).click();
  await expect
    .poll(() => s.requests.some((r) => r.path === "/api/tasks"))
    .toBeTruthy();
  expect(s.requests.find((r) => r.path === "/api/tasks").body.language).toBe(
    "es",
  );
});

test("publishing approval, completed topic results and run activity show actual execution receipts", async ({
  page,
}) => {
  const s = initial();
  s.awaitingModel = false;
  await setup(page, s);
  await page.route("**/api/model-executions/**", (route) =>
    route.fulfill({
      json: [{ step: 1, band: "standard", provider: "primary", credits: 6 }],
    }),
  );
  await page.route("**/api/topics", (route) =>
    route.fulfill({
      json: {
        run: {
          id: jobId,
          status: "completed",
          modelBand: "flagship",
          itemCount: 1,
          topicCount: 0,
          createdAt: "2026-10-22",
          completedAt: "2026-10-22",
          error: null,
        },
        topics: [],
      },
    }),
  );
  await page.route(`**/api/runs/${taskId}`, (route) =>
    route.fulfill({
      json: {
        id: taskId,
        status: "succeeded",
        workflowId: jobId,
        createdAt: "2026-10-22",
      },
    }),
  );
  await page.goto("/app#review");
  await expect(page.locator(".model-execution")).toContainText(
    "Actual execution: Standard",
  );
  await page.locator("[data-nav=reports]").click();
  await page.getByRole("tab", { name: "Topics", exact: true }).click();
  await expect(page.locator(".model-execution")).toContainText(
    "Actual execution: Standard",
  );
  await expect(page.locator(".model-execution")).toContainText(
    "Requested: Flagship",
  );
  await page.locator("[data-nav=activity]").click();
  await page.getByLabel("Workflow run UUID", { exact: true }).fill(taskId);
  await page.getByRole("button", { name: "Load run", exact: true }).click();
  await expect(page.locator(".model-execution")).toContainText(
    "Actual execution: Standard",
  );
  expect(s.requests).toHaveLength(0);
});

for (const locale of ['en','zh','es']) test(`trial ${locale}: exhausted trial can start AI handoff and payment recovery never suggests a downgrade`, async ({page})=>{
 const s=initial();s.trial=true;s.paused=true;s.available=0;s.reason='trial_payment';s.choices=[];
 await page.setViewportSize({width:390,height:844});await setup(page,s);await page.goto("/app");
 await page.locator('#workspace-language').selectOption(locale);
 const note=page.getByRole('note');await expect(note).toBeVisible();
 await expect(note).toContainText({en:'starts billing',zh:'正式扣费',es:'cobro'}[locale]);
 await expect(page.getByRole('heading',{name:/^(Automation is paused|自动化已暂停|La automatización está pausada)$/})).toHaveCount(0);
 await expect(page.getByText({en:'Your subscription payment must be confirmed',zh:'正式订阅付款尚未确认',es:'Debemos confirmar el pago'}[locale],{exact:false})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 expect(s.requests).toEqual([]);
});

test('zero trial balance can confirm a structured analysis while paid handoff is available',async({page})=>{
 const s=initial();s.trial=true;s.paused=true;s.available=0;s.awaitingModel=false;await setup(page,s);await page.goto('/app?mode=template&persona=creators#start');
 await page.getByLabel('Source name',{exact:true}).fill('Trial source');await page.getByLabel('Date / scope',{exact:true}).fill('This week');await page.getByLabel('One item per line',{exact:true}).fill('Please explain the onboarding steps.');
 await page.getByRole('button',{name:'Preview scope'}).click();await expect(page.getByRole('button',{name:'Confirm goal & run analysis'})).toBeEnabled();
 expect(s.requests).toEqual([]);
});

test('owner can confirm subscription payment recovery with zero available model choices',async({page})=>{
 const s=initial();s.trial=true;s.paused=true;s.available=0;s.reason='trial_payment';s.choices=[];await setup(page,s);await page.goto('/app');
 await page.getByRole('button',{name:'Review subscription payment'}).click();const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('combobox')).toHaveCount(0);const confirm=dialog.getByRole('button',{name:'Confirm billing & resume original model'});await expect(confirm).toBeEnabled();expect(s.requests).toEqual([]);await confirm.click();
 await expect(dialog).not.toBeVisible();expect(s.requests[0].body).toMatchObject({modelBand:'flagship'});expect(s.requests[0].body.requestId).toMatch(/^[0-9a-f-]{36}$/);
});
