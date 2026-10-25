import { expect, test } from "@playwright/test";
for (const locale of ["en", "zh", "es"])
  test(`${locale}: public pricing keeps approved denominations and explains cost metering`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/#pricing`);
    const body = page.locator("body");
    for (const price of ["$19", "$59", "$169"])
      await expect(body).toContainText(price);
    await expect(body).toContainText(locale === "es" ? "1,20" : "1.20");
    await expect(body).toContainText(locale === "es" ? "0,001" : "0.001");
    await expect(body).not.toContainText("Eco 1 / Standard 6 / Flagship 20");
    await page.goto(`/${locale === "en" ? "" : locale + "/"}for/creators/`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp("piggybot.me/.*for/creators/"),
    );
    await expect(
      page.locator('script[type="application/ld+json"]').first(),
    ).toBeAttached();
    await expect(page.locator("body")).toContainText("30");
  });
