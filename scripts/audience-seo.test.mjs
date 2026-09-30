import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
const root = new URL("../", import.meta.url);
test("nine audience pages are crawlable, internally linked and have reciprocal canonical language alternatives", async () => {
  const sitemap = await readFile(new URL("public/sitemap.xml", root), "utf8");
  for (const lang of ["en", "zh", "es"])
    for (const persona of ["creators", "sellers", "community-hosts"]) {
      const path = `${lang === "en" ? "" : lang + "/"}for/${persona}/`;
      const html = await readFile(new URL(`${path}index.html`, root), "utf8");
      assert.match(html, /<h1>[^]*?<\/h1>/);
      assert.equal((html.match(/<h1>/g) || []).length, 1);
      assert.doesNotMatch(
        html,
        /noindex|UX PREVIEW|checkout\.html|service-creators\.html/,
      );
      assert.ok(
        html.includes(
          `<link rel="canonical" href="https://www.piggybot.me/${path}"`,
        ),
      );
      assert.ok(sitemap.includes(`https://www.piggybot.me/${path}`));
      for (const alternate of ["en", "zh", "es"])
        assert.ok(
          html.includes(
            `hreflang="${alternate}" href="https://www.piggybot.me/${alternate === "en" ? "" : alternate + "/"}for/${persona}/"`,
          ),
        );
      for (const target of ["creators", "sellers", "community-hosts"])
        assert.ok(
          html.includes(
            `href="/${lang === "en" ? "" : lang + "/"}for/${target}/"`,
          ),
        );
      assert.ok(html.includes(`activate?persona=${persona}&plan=`));
      assert.ok(html.includes("https://discord.gg/sJjA3Nr6Bx"));
    }
});
