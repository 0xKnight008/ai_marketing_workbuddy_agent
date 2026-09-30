import axe from "axe-core";
import { test, expect, type Page } from "@playwright/test";
const personas = {
  creators: ["comment_insights", "demandRanking", "demand"],
  sellers: ["review_attribution", "issueClusters", "theme"],
  "community-hosts": ["community_digest", "hotTopics", "topic"],
} as const;
type Persona = keyof typeof personas;
async function fixture(
  page: Page,
  persona: Persona,
  options: { role?: string; credits?: number; existing?: boolean } = {},
) {
  const [template, section, field] = personas[persona];
  const quote = "Where can I find the guide?";
  const report = {
    id: "report-1",
    template,
    title: "September · This week",
    status: "generated",
    batchIds: ["batch-1"],
    itemCount: 2,
    createdAt: "2026-09-29",
    report: {
      summary: "A useful grounded finding.",
      [section]: [
        {
          [field]: "Make the guide easier to find",
          citations: [{ ref: "i1", snippet: quote }],
        },
      ],
      _evidence: { i1: "item-1" },
    },
  };
  const batch = {
    id: "batch-1",
    label: report.title,
    status: "classified",
    itemCount: 2,
    createdAt: "2026-09-29",
  };
  let imported = !!options.existing,
    created = !!options.existing,
    review: unknown = null;
  const mutations: Array<{ path: string; body: any }> = [];
  const control = {
    failSave: false,
    failImport: false,
    failGeneration: false,
    createdStatus: "generated",
  };
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "piggybot.ownerAccessToken",
      `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`,
    ),
  );
  page.on("pageerror", (e) => {
    throw e;
  });
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (req.method() !== "GET")
      mutations.push({ path, body: req.postDataJSON() });
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          user: { email: "test@example.invalid", passwordSet: true },
          workspace: { id: "workspace-1", name: "My studio" },
          role: options.role ?? "owner",
          plan: "creator",
          subscriptionStatus: "active",
        },
      });
    if (path === "/api/billing/usage")
      return route.fulfill(
        options.role === "editor"
          ? { status: 403, json: { error: "forbidden" } }
          : {
              json: {
                status: (options.credits ?? 30) > 0 ? "normal" : "paused",
                taskUsed: 0,
                taskQuota: 2000,
                aiCreditsAvailable: options.credits ?? 30,
                subscriptionStatus: "active",
                plan: "creator",
              },
            },
      );
    if (path === "/api/imports") {
      if (req.method() === "POST") {
        if (control.failImport) {
          control.failImport = false;
          return route.fulfill({
            status: 402,
            json: { error: "ai_credits_exhausted" },
          });
        }
        imported = true;
        return route.fulfill({ json: { ...batch, status: "pending" } });
      }
      return route.fulfill({ json: imported ? [batch] : [] });
    }
    if (path === "/api/imports/batch-1")
      return route.fulfill({
        json: {
          batch,
          items: [
            {
              id: "item-1",
              text: `${quote} I have checked the pinned messages.`,
              author: "A",
              platform: "unknown",
            },
          ],
        },
      });
    if (path === "/api/insights") {
      if (req.method() === "POST") {
        created = true;
        return route.fulfill({
          json: { ...report, report: null, status: "pending" },
        });
      }
      return route.fulfill({ json: created ? [report] : [] });
    }
    if (path === "/api/insights/report-1")
      return route.fulfill({
        json: {
          ...report,
          status: control.failGeneration ? "failed" : control.createdStatus,
          error: control.failGeneration ? "provider_unavailable" : null,
        },
      });
    if (path === "/api/insights/report-1/review") {
      if (req.method() === "PUT") {
        if (control.failSave) {
          control.failSave = false;
          return route.fulfill({
            status: 503,
            json: { error: "temporary_failure" },
          });
        }
        review = { ...req.postDataJSON(), updatedAt: new Date().toISOString() };
      }
      return route.fulfill({
        json: { review, canEdit: options.role !== "viewer" },
      });
    }
    if (path === "/api/topics")
      return route.fulfill({ json: { run: null, topics: [] } });
    if (path === "/api/imports/google/connection")
      return route.fulfill({ json: { connected: false } });
    return route.fulfill({ json: [] });
  });
  return { mutations, control, report, quote };
}
for (const persona of Object.keys(personas) as Persona[])
  for (const width of [1440, 390])
    test(`${persona} ${width}: paid import, grounded result, review, save and reopen`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const f = await fixture(page, persona);
      await page.goto(`/app?persona=${persona}#start`);
      await page.getByLabel("Source name", { exact: true }).fill("September");
      await page.getByLabel("Date / scope", { exact: true }).fill("This week");
      await page
        .getByLabel("One item per line", { exact: true })
        .fill(`${f.quote}\n${f.quote}\nA second opinion`);
      await page.getByRole("button", { name: "Preview scope" }).click();
      await expect(page.locator(".au-stats")).toContainText(
        "Duplicates removed",
      );
      expect(f.mutations).toHaveLength(0);
      await page.getByRole("button", { name: "Confirm paid import" }).click();
      await expect(page.getByText("Your sources are ready")).toBeVisible();
      expect(f.mutations[0].body).toMatchObject({
        deduplicate: true,
        sourceType: "paste",
        modelBand: "eco",
      });
      await page.getByRole("button", { name: /^Generate/ }).click();
      await expect(page.locator(".au-insight")).toBeVisible();
      expect(f.mutations[1].body).toMatchObject({
        batchIds: ["batch-1"],
        template: personas[persona][0],
        language: "en",
      });
      const save = page.getByRole("button", { name: "Save review & focus" });
      await expect(save).toBeDisabled();
      await page.getByRole("button", { name: /View source/ }).click();
      await expect(page.getByRole("dialog")).toContainText(
        "I have checked the pinned messages.",
      );
      await page.keyboard.press("Escape");
      await page.locator(".au-insight input[type=checkbox]").check();
      await page
        .getByLabel("I checked the source evidence and analysis scope.")
        .check();
      f.control.failSave = true;
      await save.click();
      await expect(page.getByRole("alert")).toContainText("temporary_failure");
      await expect(page.locator(".au-insight input")).toBeChecked();
      await save.click();
      await expect(page.getByText("Review saved. Reopen")).toBeVisible();
      await page.reload();
      await expect(page.locator(".au-insight input")).toBeChecked();
      await expect(
        page.locator(".audience-workspace [role=alert]"),
      ).toHaveCount(0);
      await expect(
        page.getByLabel("I checked the source evidence and analysis scope."),
      ).toBeChecked();
      expect(
        f.mutations.filter((m) => m.path === "/api/insights"),
      ).toHaveLength(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      if (width === 1440 && persona === "creators") {
        await page.locator("[data-nav=reports]").click();
        await page
          .getByRole("button", { name: "Open report", exact: true })
          .click();
        await expect(page.locator(".au-insight input")).toBeChecked();
      }
      if (width === 1440 && persona === "creators")
        await page.screenshot({
          path: "test-results/audience-review.png",
          fullPage: true,
        });
    });
test("CSV preview preserves distinct authors and keeps input after insufficient-credit failure", async ({
  page,
}) => {
  const f = await fixture(page, "sellers");
  f.control.failImport = true;
  await page.goto("/app?persona=sellers#start");
  await page
    .getByLabel("CSV", { exact: true })
    .setInputFiles({
      name: "reviews.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "text,author\nSame review,A\nSame review,A\nSame review,B",
      ),
    });
  await page.getByLabel("Date / scope", { exact: true }).fill("September");
  await page.getByRole("button", { name: "Preview scope" }).click();
  await expect(page.locator(".au-stats>div").nth(2).locator("b")).toHaveText(
    "2",
  );
  await page.getByRole("button", { name: "Confirm paid import" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Subscription or AI credits",
  );
  await page.getByRole("button", { name: "Back to edit" }).click();
  await expect(page.locator("textarea")).toContainText("Same review,B");
});
test("editor can analyze without billing permissions; exhausted owner can still save existing review", async ({
  page,
}) => {
  const f = await fixture(page, "creators", { role: "editor" });
  await page.goto("/app?persona=creators#start");
  await page.getByRole("button", { name: "Use example input" }).click();
  await page.getByRole("button", { name: "Preview scope" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm paid import" }),
  ).toBeEnabled();
  expect(f.mutations).toHaveLength(0);
  await page.unroute("**/api/**");
  await fixture(page, "creators", { credits: 0, existing: true });
  await page.goto("/app#start/creators/report-1");
  await expect(page.locator(".au-insight")).toBeVisible();
  await page
    .getByLabel("I checked the source evidence and analysis scope.")
    .check();
  await page.getByRole("button", { name: "Save review & focus" }).click();
  await expect(page.getByText("Review saved. Reopen")).toBeVisible();
});
test("viewer cannot save; failed generation is recoverable without silent retries", async ({
  page,
}) => {
  await fixture(page, "creators", { role: "viewer", existing: true });
  await page.goto("/app#start/creators/report-1");
  await expect(
    page.getByRole("button", { name: "Save review & focus" }),
  ).toBeDisabled();
  await page.unroute("**/api/**");
  const f = await fixture(page, "sellers", { existing: true });
  f.control.failGeneration = true;
  await page.goto("/app#start/sellers/report-1");
  await expect(
    page.getByText("Generation failed", { exact: true }),
  ).toBeVisible();
  expect(f.mutations).toHaveLength(0);
});
test("empty workspace offers three scenarios; existing work keeps its overview", async ({
  page,
}) => {
  await fixture(page, "creators");
  await page.goto("/app");
  await expect(
    page.getByText("What would you like to understand first?"),
  ).toBeVisible();
  await page.unroute("**/api/**");
  await fixture(page, "creators", { existing: true });
  await page.goto("/app");
  await expect(page.locator("[data-nav=dashboard]")).toHaveAttribute(
    "aria-current",
    "page",
  );
});
for (const locale of ["en", "zh", "es"])
  for (const persona of Object.keys(personas) as Persona[])
    test(`${locale} ${persona}: static content, metadata, keyboard tabs and mobile CTA`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const path = `${locale === "en" ? "" : `/${locale}`}/for/${persona}/`;
      const response = await page.request.get(path);
      const html = await response.text();
      expect(html).toContain("<h1>");
      expect(html).not.toContain("noindex");
      expect(html).not.toContain("UX PREVIEW");
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator("link[rel=canonical]")).toHaveAttribute(
        "href",
        `https://www.piggybot.me${path}`,
      );
      expect(await page.locator("link[hreflang]").count()).toBe(4);
      const tabs = page.getByRole("tab");
      await tabs.first().focus();
      await page.keyboard.press("ArrowRight");
      await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".mobile-cta a")).toHaveAttribute(
        "href",
        new RegExp(`persona=${persona}&plan=`),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      if (locale === "zh" && persona === "creators")
        await page.screenshot({
          path: "test-results/creators-mobile.png",
          fullPage: true,
        });
    });

test("result and mobile landing pass accessibility checks; language preference survives reload", async ({
  page,
}) => {
  await fixture(page, "creators", { existing: true });
  await page.goto("/app?locale=zh#start/creators/report-1");
  await expect(page.locator("#workspace-language")).toHaveValue("zh");
  await page.locator("#workspace-language").selectOption("es");
  await page.reload();
  await expect(page.locator("#workspace-language")).toHaveValue("es");
  await expect(page.locator(".au-insight")).toBeVisible();
  for (const landing of [false, true]) {
    if (landing) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/es/for/sellers/");
    }
    await page.addScriptTag({ content: axe.source });
    const result = await page.evaluate(async () =>
      (window as unknown as { axe: typeof axe }).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      }),
    );
    expect(result.violations).toEqual([]);
  }
});
