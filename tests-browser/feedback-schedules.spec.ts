import { test, expect, type Page } from "@playwright/test";
import axe from "axe-core";
const accountId = "11111111-1111-4111-8111-111111111111";
async function fixture(page: Page, locale = "en", path = "#start") {
  const calls: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  }> = [];
  let schedules: Record<string, unknown>[] = [];
  let approval = {
    id: "approval-1",
    version: 1,
    requestedAt: "2026-11-05",
    requestedAction: {
      actionType: "insight.deliver_report",
      summary: "Review customer digest",
      parameters: {
        channel: "email",
        subject: "Original subject",
        content: "Original body",
        targetLabel: "owner@example.invalid",
      },
    },
  };
  let decided = false;
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "piggybot.ownerAccessToken",
      `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`,
    ),
  );
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname,
      method = req.method();
    if (method !== "GET")
      calls.push({ path: p, method, body: req.postDataJSON() ?? {} });
    if (p === "/api/auth/me")
      return route.fulfill({
        json: {
          user: {
            email: "owner@example.invalid",
            displayName: "Owner",
            passwordSet: true,
          },
          workspace: { id: "workspace-1", name: "Feedback Studio" },
          role: "owner",
          plan: "creator",
          subscriptionStatus: "active",
        },
      });
    if (p === "/api/billing/usage")
      return route.fulfill({
        json: {
          status: "active",
          taskUsed: 1,
          taskQuota: 100,
          aiCreditsAvailable: 100,
          plan: "creator",
          subscriptionStatus: "active",
        },
      });
    if (p === "/api/feedback/accounts")
      return route.fulfill({
        json: [
          {
            id: accountId,
            displayName: "My YouTube",
            platform: "youtube",
            status: "connected",
            supported: true,
            postsSupported: true,
          },
          {
            id: "disabled",
            displayName: "My Pinterest",
            platform: "pinterest",
            status: "connected",
            supported: false,
            postsSupported: true,
          },
        ],
      });
    if (p.endsWith('/posts') && p.startsWith('/api/feedback/accounts/')) return route.fulfill({json:{posts:[],limit:25}});
    if (p === "/api/feedback/scans")
      return route.fulfill({ json: { id: "scan-1" } });
    if (p === "/api/feedback/scans/scan-1")
      return route.fulfill({
        json: {
          id: "scan-1",
          status: "partial",
          batchId: "batch-1",
          itemCount: 12,
          createdAt: "2026-11-05T09:00:00Z",
          coverage: [
            {
              accountId,
              displayName: "My YouTube",
              complete: false,
              inserted: 12,
              duplicates: 3,
              error: "feedback_rate_limited",
            },
          ],
        },
      });
    if (p === "/api/feedback/schedules" && method === "POST") {
      schedules = [
        {
          ...req.postDataJSON(),
          id: "schedule-1",
          version: 1,
          nextRunAt: "2026-11-06T01:00:00Z",
        },
      ];
      return route.fulfill({ json: { id: "schedule-1" } });
    }
    if (p === "/api/feedback/schedules")
      return route.fulfill({ json: schedules });
    if (p.endsWith("/schedule-1/pause")) {
      schedules = schedules.map((s) => ({ ...s, enabled: false, version: 2 }));
      return route.fulfill({ json: { id: "schedule-1" } });
    }
    if (p.endsWith("/history")) return route.fulfill({ json: [] });
    if (p === "/api/approval-requests")
      return route.fulfill({ json: decided ? [] : [approval] });
    if (p.endsWith("/approval-1/content")) {
      const b = req.postDataJSON();
      approval = {
        ...approval,
        version: 2,
        requestedAction: {
          ...approval.requestedAction,
          parameters: {
            ...approval.requestedAction.parameters,
            subject: b.subject,
            content: b.content,
          },
        },
      };
      return route.fulfill({ json: approval });
    }
    if (p.endsWith("/approval-1/approved")) {
      decided = true;
      return route.fulfill({ json: { status: "approved" } });
    }
    if (p === "/api/topics")
      return route.fulfill({ json: { run: null, topics: [] } });
    if (p === "/api/task-preferences")
      return route.fulfill({
        json: {
          persona: "creators",
          modelBand: "standard",
          language: locale,
          goal: "",
        },
      });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/login?locale=${locale}${path}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-nav=start]")).toBeVisible();
  return calls;
}
for (const locale of ["en", "zh", "es"])
  for (const width of [390, 1440])
    test(`${locale}/${width}: schedule entry, dark mode, consent form and accessible layout`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await fixture(page, locale);
      await page.locator("[data-nav=schedules]").click();
      await expect(page.locator("[data-nav=review]")).toHaveCount(0);
      const appearance = page.getByLabel(
        { en: "Appearance", zh: "外观显示", es: "Apariencia" }[locale]!,
      );
      await appearance.selectOption("dark");
      await expect(page.locator("html")).toHaveAttribute(
        "data-workspace-theme",
        "dark",
      );
      await page
        .getByRole("button", {
          name: {
            en: "New scheduled task",
            zh: "新建定时任务",
            es: "Nueva tarea programada",
          }[locale],
          exact: true,
        })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        const a = (window as unknown as { axe: typeof axe }).axe;
        return (
          await a.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations;
      });
      expect(violations).toEqual([]);
      await page.screenshot({
        path: `/tmp/feedback-built-${locale}-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute(
        "data-workspace-theme",
        "dark",
      );
    });
test("partial feedback requires scope acceptance before goal; collection alone does not quote AI", async ({
  page,
}) => {
  const calls = await fixture(page);
  await page.getByLabel("Source type", { exact: true }).selectOption("scan");
  await page.getByLabel("My YouTube", { exact: false }).check();
  await expect(
    page.getByLabel("My Pinterest", { exact: false }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Collect channel feedback", exact: true })
    .click();
  const next = page.getByRole("button", {
    name: "Confirm goal →",
    exact: true,
  });
  await expect(next).toBeDisabled();
  await page
    .getByLabel("Analyze only the collected evidence; I understand the gaps.")
    .check();
  await next.click();
  await expect(page.getByLabel("Task goal", { exact: true })).toBeVisible();
  expect(calls.map((c) => c.path)).toEqual([
    "/api/feedback/scans",
    "/api/feedback/scans/scan-1/accept",
  ]);
});
test("scheduled task persists explicit consent and pauses with version", async ({
  page,
}) => {
  const calls = await fixture(page, "en", "#schedules");
  await page
    .getByRole("button", { name: "New scheduled task", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name", { exact: true }).fill("Daily customer feedback");
  await d.getByLabel("My YouTube", { exact: false }).check();
  await d
    .getByLabel("Analysis goal", { exact: true })
    .fill("Explain onboarding friction with citations");
  await d.getByLabel("Daily credit ceiling", { exact: true }).fill("12");
  await expect(d.getByRole("button", { name: "Save schedule" })).toBeDisabled();
  await d
    .getByLabel(
      "I authorize recurring collection and analysis within this daily ceiling.",
    )
    .check();
  await d.getByRole("button", { name: "Save schedule" }).click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Daily customer feedback" }),
  ).toBeVisible();
  expect(calls[0].body).toMatchObject({
    consent: true,
    dailyCredits: 12,
    accountIds: [accountId],
  });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review & resume" }),
  ).toBeVisible();
  expect(calls[1].body).toEqual({ expectedVersion: 1 });
});
test("legacy review opens unified page; editing saves a new version and approval sends that version", async ({
  page,
}) => {
  const calls = await fixture(page, "en", "#review");
  await expect(page.locator("[data-nav=pipelines]")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("button", { name: "Edit content", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Email subject", { exact: true })
    .fill("Reviewed subject");
  await page.getByLabel("Message", { exact: true }).fill("Reviewed exact body");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.locator(".approval-snapshot")).toHaveText(
    "Reviewed exact body",
  );
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("dialog").locator("pre")).toHaveText(
    "Reviewed exact body",
  );
  await page.getByRole("button", { name: "Confirm decision" }).click();
  expect(calls[0].body).toEqual({
    expectedVersion: 1,
    content: "Reviewed exact body",
    subject: "Reviewed subject",
  });
  expect(calls[1].body).toEqual({ expectedVersion: 2 });
});

for(const locale of ['en','zh','es'] as const)test(`${locale}: TikTok preview is explicit, read-only and separate from comment permission`,async({page})=>{
  const calls=await fixture(page,locale);
  let reads=0;
  await page.route('**/api/feedback/accounts',route=>route.fulfill({json:[{id:accountId,displayName:'Dora2000',platform:'tiktok',status:'connected',supported:true,postsSupported:true},{id:'pin',displayName:'My Pinterest',platform:'pinterest',status:'connected',supported:false,postsSupported:true}]}));
  await page.route('**/api/feedback/accounts/*/posts',route=>{reads++;return route.fulfill({json:{posts:[{id:'video',text:'Post preview evidence',url:'https://www.tiktok.com/@dora/video/123',publishedAt:'2026-11-07T00:00:00Z'}]}})});
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByLabel({en:'Source type',zh:'来源类型',es:'Tipo de fuente'}[locale],{exact:true}).selectOption('scan');
  const dora=page.getByRole('checkbox',{name:/Dora2000/});await expect(dora).toBeEnabled();
  await expect(page.getByRole('checkbox',{name:/My Pinterest/})).toBeDisabled();expect(reads).toBe(0);
  await page.getByRole('button',{name:/.* · Dora2000/}).click();await expect(page.getByText('Post preview evidence',{exact:true})).toBeVisible();expect(reads).toBe(1);expect(calls).toEqual([]);
  await expect(page.getByRole('link',{name:{en:'Open original post',zh:'打开原帖',es:'Abrir publicación original'}[locale]})).toHaveAttribute('href','https://www.tiktok.com/@dora/video/123');
});
test('preview handles expired authorization and empty retry without importing sources',async({page})=>{
  const calls=await fixture(page);let attempt=0;
  await page.route('**/api/feedback/accounts/*/posts',route=>++attempt===1?route.fulfill({status:422,json:{error:'feedback_reconnect_required'}}):route.fulfill({json:{posts:[]}}));
  await page.getByLabel('Source type',{exact:true}).selectOption('scan');
  await page.getByRole('button',{name:'View recent posts · My YouTube',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Reconnect this account');
  await page.getByRole('alert').getByRole('button',{name:'Retry'}).click();
  await expect(page.getByText('The provider returned no recent posts.',{exact:true})).toBeVisible();expect(calls).toEqual([]);
});
test('account sync hides disconnected history, keeps expired connections and preserves list on failure',async({page})=>{
  await fixture(page,'en','#accounts');let synced=false,fail=false;
  await page.route('**/api/zernio/accounts',route=>route.fulfill({json:[{id:'active',platform:'tiktok',displayName:'Active Dora',status:'connected',capabilities:['publish']},{id:'gone',platform:'twitter',displayName:'Removed Dora',status:synced?'disconnected':'connected',capabilities:[]},{id:'expired',platform:'youtube',displayName:'Reconnect Dora',status:'expired',capabilities:[]}]}));
  await page.route('**/api/zernio/sync',route=>{if(fail)return route.fulfill({status:503,json:{error:'supplier_unavailable'}});synced=true;return route.fulfill({json:{synced:2}})});
  await page.reload({ waitUntil: "domcontentloaded" });await expect(page.getByRole('heading',{name:'Removed Dora',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sync account health',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Removed Dora',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Reconnect Dora',exact:true})).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });await expect(page.getByRole('heading',{name:'Active Dora',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Removed Dora',exact:true})).toHaveCount(0);
  fail=true;await page.getByRole('button',{name:'Sync account health',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Sync failed.');await expect(page.getByRole('heading',{name:'Active Dora',exact:true})).toBeVisible();
});
