import { test, expect, type Page } from "@playwright/test";
import axe from "axe-core";
const batchId = "11111111-1111-4111-8111-111111111111",
  itemId = "22222222-2222-4222-8222-222222222222",
  messageId = "33333333-3333-4333-8333-333333333333";
const quote = "Where can I find the guide?";
function state() {
  return {
    task: null as any,
    messages: [] as any[],
    preferences: {
      persona: "creators",
      modelBand: "standard",
      language: "en",
      goal: "",
    },
    requests: [] as Array<{ path: string; body: any }>,
    failTurn: false,paused:false,costMode:false,shadowMode:false,trialBudget:false,
    turns: 0,
  };
}
async function fixture(page: Page, s: ReturnType<typeof state>) {
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "piggybot.ownerAccessToken",
      `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`,
    ),
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      body = request.method() === "GET" ? null : request.postDataJSON();
    if (body) s.requests.push({ path, body });
    if(path==='/api/billing/ai-quote')return route.fulfill({json:(s.costMode||s.shadowMode)?{mode:s.costMode?'cost-v1':'shadow',quoteId:'55555555-5555-4555-8555-555555555555',estimatedCredits:12,maxCredits:body.maxCredits??30,expiresAt:new Date(Date.now()+600000).toISOString(),subscriptionPaymentRequired:s.trialBudget&&(body.maxCredits??30)>30}:{mode:'legacy'}});
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          user: { email: "test@example.invalid", passwordSet: true },
          workspace: {
            id: "44444444-4444-4444-8444-444444444444",
            name: "Task regression",
          },
          role: "owner",
          plan: "growth",
          subscriptionStatus: "active",
        },
      });
    const usage = {
      status: s.paused?"paused":"normal",
      taskUsed: 1,
      taskQuota: 100,
      aiCreditsUsed: 1,
      aiCreditsAvailable: 999,
      plan: "growth",
      subscriptionStatus: "active",
    };
    if (path === "/api/billing/usage") return route.fulfill({ json: usage });
    if (path === "/api/billing/dashboard")
      return route.fulfill({
        json: {
          usage,
          subscription: null,
          syncError: false,
          creditBalance: 0,
          refundDebt: 0,
          includedCredits: 1000,
          canManage: true,
          canUpgrade: true,
          canTopup: true,
          topups: [],
        },
      });
    if (path === "/api/task-preferences") {
      if (body) s.preferences = { ...body };
      return route.fulfill({ json: s.preferences });
    }
    if (path === "/api/tasks" && body) {
      s.task = {
        ...body,
        id: body.requestId,
        sourceKind: "conversation",
        sourceId: null,
        status: "ready",
        version: 0,
        batchIds: body.batchIds,
        archivedAt: null,
      };
      return route.fulfill({ json: s.task });
    }
    if (path === "/api/tasks") {
      const kind = url.searchParams.get("kind"),
        status = url.searchParams.get("status");
      return route.fulfill({
        json:
          s.task &&
          !!s.task.archivedAt === (url.searchParams.get("archived") === "1") &&
          (!kind || s.task.sourceKind === kind) &&
          (!status || s.task.status === status)
            ? [s.task]
            : [],
      });
    }
    if (path === "/api/imports" && body) {
      if (s.task) {
        s.task.batchIds = [batchId];
        s.task.version++;
      }
      return route.fulfill({
        json: { id: batchId, status: "pending", label: body.label },
      });
    }
    if (path === "/api/imports")
      return route.fulfill({
        json: [{ id: batchId, label: "Saved feedback", status: "classified" }],
      });
    if (path.endsWith("/messages")) {
      if (s.failTurn)
        return route.fulfill({
          status: 503,
          json: { error: "temporarily_unavailable" },
        });
      s.turns++;
      s.messages.push(
        {
          id: crypto.randomUUID(),
          role: "user",
          content: body.message,
          status: "completed",
          citations: [],
        },
        {
          id: s.turns === 1 ? messageId : crypto.randomUUID(),
          role: "assistant",
          content:
            s.turns === 1
              ? "## Finding\n\nNew members need a visible guide."
              : "## Reply\n\nWelcome! Here is the guide.",
          status: "completed",
          citations: [{ ref: itemId, snippet: quote }],
          ...(s.costMode?{costReceipt:{id:'55555555-5555-4555-8555-555555555555',band:body.modelBand,state:'settled',maxCredits:30,heldCredits:0,settledCredits:12,releasedCredits:18,actualModels:['actual-fixture']}}:{}),
        },
      );
      s.task.status = "completed";
      s.task.version += 2;
      s.task.modelBand = body.modelBand;
      return route.fulfill({ json: { messageId, version: s.task.version } });
    }
    if (path.endsWith("/archive")) {
      s.task.archivedAt = body.archived ? "2026-10-22T00:00:00Z" : null;
      return route.fulfill({ json: s.task });
    }
    if (path.endsWith("/review")) {
      s.task.review = { ...body };
      return route.fulfill({ json: body });
    }
    if (path.includes("/evidence/"))
      return route.fulfill({
        json: {
          text: quote + " I checked the pinned messages.",
          author: "New member",
        },
      });
    if (path.startsWith("/api/tasks/"))
      return route.fulfill({ json: { task: s.task, messages: s.messages } });
    if (path === "/api/feedback")
      return route.fulfill({ json: { ticketId: "FB-12345678" } });
    if (path === "/api/topics")
      return route.fulfill({ json: { run: null, topics: [] } });
    return route.fulfill({ json: [] });
  });
}
async function createTask(page: Page, modelBand = "flagship") {
  await page.goto("/app");
  await page.getByLabel("Source name", { exact: true }).fill("Comments");
  await page.getByLabel("One item per line", { exact: true }).fill(quote);
  await page
    .getByRole("button", { name: "Confirm the goal →", exact: true })
    .click();
  await page
    .getByLabel("Task goal", { exact: true })
    .fill("Find onboarding friction and draft a useful reply");
  await page
    .getByLabel("Model capability", { exact: true })
    .selectOption(modelBand);
  await page
    .getByRole("button", { name: "Run this task", exact: true })
    .click();
  await expect(page.locator(".task-message")).toHaveCount(2);
}

test("new task uses the selected band, persists evidence review and continues arbitrary goals", async ({
  page,
}) => {
  const s = state();
  await fixture(page, s);
  await createTask(page);
  expect(
    s.requests
      .filter((r) => ["/api/tasks", "/api/imports"].includes(r.path))
      .every((r) => r.body.modelBand === "flagship"),
  ).toBeTruthy();
  expect(s.requests.find((r) => r.path === "/api/imports")!.body.taskId).toBe(
    s.task.id,
  );
  await page.getByRole("button", { name: "View source", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "I checked the pinned messages.",
  );
  await page.keyboard.press("Escape");
  await page.getByLabel("I checked the source evidence and scope.").check();
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review saved", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Review saved", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Continue this task", { exact: true })
    .fill("Now write a welcome reply in Spanish.");
  await page.getByRole("button", { name: "Send follow-up" }).click();
  await expect(page.locator(".task-message")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Help & support", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("Help with the result");
  await page.getByRole("button", { name: "Send to support" }).click();
  await expect(page.getByRole("status")).toContainText("FB-12345678");
  expect(s.requests.find((r) => r.path === "/api/feedback")!.body.taskId).toBe(
    s.task.id,
  );
});
test("failed turn retry retains text and the request key", async ({ page }) => {
  const s = state();
  await fixture(page, s);
  await createTask(page);
  s.failTurn = true;
  await page
    .getByLabel("Continue this task", { exact: true })
    .fill("A new goal for this task");
  await page.getByRole("button", { name: "Send follow-up" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "temporarily_unavailable",
  );
  await expect(
    page.getByLabel("Continue this task", { exact: true }),
  ).toHaveValue("A new goal for this task");
  s.failTurn = false;
  await page.getByRole("button", { name: "Send follow-up" }).click();
  await expect(page.locator(".task-message")).toHaveCount(4);
  const attempts = s.requests
    .filter((r) => r.path.endsWith("/messages"))
    .slice(-2);
  expect(attempts[0].body.requestId).toBe(attempts[1].body.requestId);
});
test("failed task removal and preferences survive a separate browser context", async ({
  page,
  browser,
}) => {
  const s = state();
  await fixture(page, s);
  await createTask(page);
  s.task.status = "failed";
  await page.reload();
  await page
    .getByRole("button", { name: "Remove failed task", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Operation reason")
    .fill("Superseded by a corrected task");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(page.locator(".task-conversation")).toContainText("Removed");
  const context = await browser.newContext(),
    second = await context.newPage();
  await fixture(second, s);
  await second.goto("/app");
  await second
    .getByRole("button", { name: "Task history", exact: true })
    .click();
  await expect(second.getByText(s.task.goal, { exact: true })).toHaveCount(0);
  await second.getByLabel("Show removed tasks").check();
  await expect(second.getByText(s.task.goal, { exact: true })).toBeVisible();
  await second.locator("[data-nav=settings]").click();
  await second
    .getByRole("tab", { name: "Account & referrals", exact: true })
    .click();
  await second
    .getByLabel("Default goal", { exact: true })
    .fill("Compare product reviews");
  await second
    .getByRole("button", { name: "Save defaults", exact: true })
    .click();
  await expect(
    second.getByRole("status").filter({ hasText: "Defaults saved" }),
  ).toBeVisible();
  await context.close();
  await page.goto("/app");
  await page
    .getByLabel("Source type", { exact: true })
    .selectOption("existing");
  await page.getByLabel("Saved feedback", { exact: true }).check();
  await page
    .getByRole("button", { name: "Confirm the goal →", exact: true })
    .click();
  await expect(page.getByLabel("Task goal", { exact: true })).toHaveValue(
    "Compare product reviews",
  );
});
for (const locale of ["en", "zh", "es"])
  for (const width of [390, 1440])
    test(`${locale} ${width}: goal interface is accessible`, async ({
      page,
    }) => {
      const s = state();
      await fixture(page, s);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/app?locale=${locale}`);
      await expect(page.locator(".task-new")).toBeVisible();
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        return (
          await (window as any).axe.run(document, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
            },
          })
        ).violations;
      });
      expect(violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      if (locale === "zh" && width === 1440)
        await page.screenshot({
          path: "/tmp/piggy-phase-two-goal-zh.png",
          fullPage: true,
        });
    });

test("admin requires a reason and shows task-linked support in Chinese and English", async ({
  page,
}) => {
  let submitted: any = null;
  await page.route("**/api/admin/auth/session", (r) =>
    r.fulfill({ json: { email: "admin@example.invalid" } }),
  );
  await page.route("**/api/admin/feedback?**", (r) =>
    r.fulfill({
      json: [
        {
          id: "ticket",
          ticketNo: "FB-12345678",
          email: "user@example.invalid",
          message: "Need help",
          status: "new",
          createdAt: "2026-10-22",
          taskId: batchId,
          taskContext: { goal: "Find onboarding friction" },
        },
      ],
    }),
  );
  await page.route("**/api/admin/feedback/FB-12345678", (r) => {
    submitted = r.request().postDataJSON();
    return r.fulfill({ json: { status: "closed" } });
  });
  await page.goto("/app/admin");
  await page.getByRole("tab", { name: "Support tickets", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Task context" }).click();
  await expect(page.locator("table")).toContainText("Find onboarding friction");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Confirm", exact: true }),
  ).toBeDisabled();
  expect(submitted).toBeNull();
  await dialog
    .getByLabel("Operation reason")
    .fill("Reviewed the linked task and resolved the question");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(submitted.reason).toContain("Reviewed the linked task");
  await page.locator(".admin-brand-bar select").selectOption("zh");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("操作原因");
});

test("late preference loading never overwrites an edited goal", async ({
  page,
}) => {
  const s = state();
  await fixture(page, s);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/task-preferences", async (route) => {
    await gate;
    return route.fulfill({
      json: {
        ...s.preferences,
        goal: "Saved default arriving late",
        modelBand: "flagship",
      },
    });
  });
  await page.goto("/app");
  await page.getByLabel("Source name", { exact: true }).fill("Comments");
  await page.getByLabel("One item per line", { exact: true }).fill(quote);
  await page
    .getByRole("button", { name: "Confirm the goal →", exact: true })
    .click();
  await page.getByLabel("Task goal", { exact: true }).fill("My current goal");
  const response = page.waitForResponse("**/api/task-preferences");
  release();
  await response;
  await expect(page.getByLabel("Task goal", { exact: true })).toHaveValue(
    "My current goal",
  );
});
test("slow CSV reads cannot submit stale content from a previously selected file", async ({
  page,
}) => {
  const s = state();
  await fixture(page, s);
  await page.addInitScript(() => {
    const read = File.prototype.text;
    File.prototype.text = async function () {
      await new Promise<void>((resolve) => {
        (window as any).releaseCsv = resolve;
      });
      return read.call(this);
    };
  });
  await page.goto("/app");
  await page.getByLabel("Source type", { exact: true }).selectOption("csv");
  await page.getByLabel("Source name", { exact: true }).fill("CSV scope");
  const file = page.locator("input[type=file]"),
    next = page.getByRole("button", {
      name: "Confirm the goal →",
      exact: true,
    });
  await file.setInputFiles({
    name: "first.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("text\nFirst source"),
  });
  await expect(next).toBeDisabled();
  await page.evaluate(() => (window as any).releaseCsv());
  await expect(next).toBeEnabled();
  await file.setInputFiles({
    name: "second.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("text\nSecond source"),
  });
  await expect(next).toBeDisabled();
  await page.evaluate(() => (window as any).releaseCsv());
  await expect(next).toBeEnabled();
  await next.click();
  await page
    .locator("summary")
    .filter({ hasText: "Review source scope" })
    .click();
  await expect(page.locator("pre")).toContainText("Second source");
  await expect(page.locator("pre")).not.toContainText("First source");
  expect(s.requests).toHaveLength(0);
});


test('paused billing still allows saving an existing task review without another AI turn',async({page})=>{const s=state();await fixture(page,s);await createTask(page);s.paused=true;await page.reload();await expect(page.getByRole('heading',{name:'Automation is paused',exact:true})).toBeVisible();await page.getByLabel('I checked the source evidence and scope.').check();await expect(page.getByRole('button',{name:'Save review',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Save review',exact:true}).click();await expect(page.getByRole('button',{name:'Review saved',exact:true})).toBeDisabled();await expect(page.getByLabel('Continue this task',{exact:true})).toBeDisabled();expect(s.turns).toBe(1);});


test('mobile conversation keeps exports and sending clear of the support launcher',async({page})=>{await page.setViewportSize({width:390,height:844});const s=state();await fixture(page,s);await createTask(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.getByLabel('Continue this task',{exact:true}).fill('Write a short reply');await page.getByRole('button',{name:'Send follow-up'}).click();await expect(page.locator('.task-message')).toHaveCount(4);await page.screenshot({path:'/tmp/piggy-phase-two-mobile-conversation.png',fullPage:true});});

for(const locale of ['en','zh','es'] as const)test(`${locale}: budget cancellation makes no generation request, confirmation binds the quote and shows actual settlement`,async({page})=>{
 const s=state();await fixture(page,s);await createTask(page);s.costMode=true;
 await page.setViewportSize({width:390,height:950});await page.goto(`/app?locale=${locale}#start/task/${s.task.id}`);
 const label={en:'Continue this task',zh:'继续这个任务',es:'Continuar tarea'}[locale],send={en:'Send follow-up',zh:'发送后续目标',es:'Enviar seguimiento'}[locale];
 await page.getByLabel(label,{exact:true}).fill('Analyze another goal');const before=s.requests.filter(r=>r.path.endsWith('/messages')).length;
 await page.getByRole('button',{name:send,exact:true}).click();let dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();expect(s.requests.filter(r=>r.path.endsWith('/messages'))).toHaveLength(before);
 await page.getByRole('button',{name:send,exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('spinbutton').fill('40');
 await dialog.getByRole('button',{name:{en:'Confirm budget and continue',zh:'确认预算并继续',es:'Confirmar y continuar'}[locale],exact:true}).click();
 await expect(dialog).not.toBeVisible();await expect(page.locator('.task-message')).toHaveCount(4);
 expect(s.requests.filter(r=>r.path.endsWith('/messages')).at(-1)!.body.aiQuoteId).toBe('55555555-5555-4555-8555-555555555555');
 await expect(page.getByRole('note').filter({hasText:'actual-fixture'})).toContainText('12');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('raising a trial budget requires a visible subscription charge notice and another confirmation',async({page})=>{
 const s=state();await fixture(page,s);await createTask(page);s.costMode=true;s.trialBudget=true;
 await page.getByLabel('Continue this task',{exact:true}).fill('Another goal');await page.getByRole('button',{name:'Send follow-up',exact:true}).click();
 const before=s.requests.filter(r=>r.path.endsWith('/messages')).length,dialog=page.getByRole('dialog');await dialog.getByRole('spinbutton').fill('40');
 await dialog.getByRole('button',{name:'Confirm budget and continue',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('starts billing');
 expect(s.requests.filter(r=>r.path.endsWith('/messages'))).toHaveLength(before);await page.keyboard.press('Escape');
});


for (const band of ['eco', 'standard', 'flagship']) {
  test(`shadow ${band}: a new task binds import and turn quotes without a live-billing dialog`, async ({ page }) => {
    const s = state();
    s.shadowMode = true;
    await fixture(page, s);
    await createTask(page, band);
    await expect(page.getByRole('dialog', { name: 'Confirm AI budget' })).toHaveCount(0);
    expect(s.requests.filter(r => r.path === '/api/billing/ai-quote').map(r => r.body)).toEqual([
      { kind: 'import.classify', modelBand: band },
      { kind: 'task.turn', modelBand: band },
    ]);
    const writes = s.requests.filter(r => r.path === '/api/imports' || r.path.endsWith('/messages'));
    expect(writes).toHaveLength(2);
    for (const { body } of writes) {
      expect(body.modelBand).toBe(band);
      expect(body.aiQuoteId).toBe('55555555-5555-4555-8555-555555555555');
    }
  });
}
