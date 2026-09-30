import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIENCES,
  AUDIENCE_TEMPLATE,
  audience,
  audiencePath,
  audienceWorkspace,
} from "./audience";
import {
  checkoutAuthPath,
  safeNextPath,
} from "../../../src/lib/auth-navigation";
test("known scenario survives checkout authentication and routes to its matching task", () => {
  for (const persona of AUDIENCES)
    for (const locale of ["en", "zh", "es"]) {
      const path = `${locale === "en" ? "" : `/${locale}`}/activate`;
      const auth = checkoutAuthPath(
        path,
        `?persona=${persona}&placement=hero`,
        "creator",
        "month",
      );
      const next = safeNextPath(
        new URL(auth, "https://www.piggybot.me").search,
        "https://www.piggybot.me",
      );
      assert.equal(
        new URL(next, "https://www.piggybot.me").searchParams.get("persona"),
        persona,
      );
      assert.equal(
        new URL(next, "https://www.piggybot.me").searchParams.get("placement"),
        "hero",
      );
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
