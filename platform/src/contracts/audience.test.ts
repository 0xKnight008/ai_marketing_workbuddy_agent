import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIENCES,
  AUDIENCE_TEMPLATE,
  audience,
  audiencePath,
  audienceWorkspace,
} from "./audience";
test("known scenarios route to their matching workspace task", () => {
  for (const persona of AUDIENCES)
    for (const locale of ["en", "zh", "es"]) {
      assert.match(
        audienceWorkspace(persona, locale),
        new RegExp(`persona=${persona}#start$`),
      );
      assert.equal(
        audiencePath(persona, locale),
        `${locale === "en" ? "" : `/${locale}`}/for/${persona}/`,
      );
    }
  assert.deepEqual(Object.values(AUDIENCE_TEMPLATE), [
    "comment_insights",
    "review_attribution",
    "community_digest",
  ]);
  assert.equal(audience("__proto__"), undefined);
  assert.equal(audience("https://other.invalid"), undefined);
});
