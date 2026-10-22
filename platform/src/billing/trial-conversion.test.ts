import assert from "node:assert/strict";
import test from "node:test";
import type { TenantTransaction } from "../foundation/database";
import { convertSubscribedTrial } from "./trial-conversion";
import {
  reserveAiRun,
  TrialConversionRequired,
  usageSnapshot,
} from "./guardrails";
function fixture() {
  const state = {
    status: "trialing",
    used: 29,
    carry: 0,
    writes: 0,
    events: [] as unknown[][],
    binding: true,
  };
  const tx: TenantTransaction = {
    query: async (sql, values = []) => {
      if (sql.includes("FOR UPDATE"))
        return {
          rows: state.binding
            ? [
                {
                  customerId: "cus_trial",
                  subscriptionId: "sub_trial",
                  priceId: "price_trial",
                  status: state.status,
                },
              ]
            : [],
          rowCount: state.binding ? 1 : 0,
        } as any;
      if (sql.includes("RETURNING plan"))
        return {
          rows: [
            {
              plan: "creator",
              subscriptionStatus: state.status,
              purchasedCredits: 0,
              trialConversionBound: state.binding,
              trialCreditCarryover: state.carry,
              trialEndsAt: new Date(Date.now() + 60000).toISOString(),
            },
          ],
          rowCount: 1,
        } as any;
      if (sql.includes('AS "taskUsed"'))
        return {
          rows: [{ taskUsed: 0, aiCreditsUsed: 0, supplierSpendMicros: 0 }],
          rowCount: 1,
        } as any;
      if (sql.includes('AS "trialCreditsUsed"'))
        return { rows: [{ trialCreditsUsed: state.used }], rowCount: 1 } as any;
      if (sql.includes("connectedAccounts"))
        return { rows: [{ connectedAccounts: 0 }], rowCount: 1 } as any;
      if (sql.includes("SET subscription_status='active'")) {
        state.status = "active";
        state.carry = 30 - state.used;
        state.writes++;
      }
      if (sql.startsWith("INSERT INTO task_event"))
        state.events.push([...values]);
      return { rows: [], rowCount: 1 };
    },
  };
  const subscription: any = {
    id: "sub_trial",
    customer: "cus_trial",
    status: "trialing",
    collection_method: "charge_automatically",
    metadata: { workspaceId: "workspace" },
    items: { data: [{ price: { id: "price_trial" } }] },
  };
  const invoice = {
    id: "in_trial",
    customer: "cus_trial",
    subscription: "sub_trial",
    billing_reason: "subscription_cycle",
    status: "paid",
  };
  return { state, tx, subscription, invoice };
}
test("subscribed trials request paid handoff before any downgrade or credit write", async () => {
  for (const used of [11, 29, 30]) {
    const f = fixture();
    f.state.used = used;
    await assert.rejects(
      reserveAiRun(f.tx, ["flagship"], { subjectId: "subject" }, "flagship"),
      TrialConversionRequired,
    );
    assert.equal(f.state.events.length, 0);
  }
});
test("zero-credit subscribed trial permits queuing without granting paid credits", async () => {
  const f = fixture();
  f.state.used = 30;
  const usage = await usageSnapshot(f.tx);
  assert.equal(usage.aiCreditsAvailable, 0);
  assert.equal(usage.trialConversionAvailable, true);
  assert.equal(usage.status, "paused");
});
for (const change of [
  { customer: "cus_other" },
  { metadata: { workspaceId: "other" } },
  { cancel_at_period_end: true },
  { collection_method: "send_invoice" },
  { status: "canceled" },
  { pause_collection: { behavior: "void" } },
  { items: { data: [{ price: { id: "price_other" } }] } },
])
  test(`rejects non-owned or non-renewing subscription ${JSON.stringify(change)}`, async (t) => {
    const f = fixture();
    Object.assign(f.subscription, change);
    let posts = 0;
    t.mock.method(
      globalThis,
      "fetch",
      async (_url: unknown, init?: RequestInit) => {
        if (init?.method === "POST") posts++;
        return Response.json(f.subscription);
      },
    );
    assert.equal(
      await convertSubscribedTrial(f.tx, "workspace", "test-only"),
      false,
    );
    assert.equal(f.state.writes, 0);
    assert.equal(posts, 0);
  });
test("declined payment grants no paid allowance or ledger write", async (t) => {
  const f = fixture();
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) =>
      init?.method === "POST"
        ? Response.json({ error: "card_declined" }, { status: 402 })
        : Response.json(f.subscription),
  );
  assert.equal(
    await convertSubscribedTrial(f.tx, "workspace", "test-only"),
    false,
  );
  assert.equal(f.state.status, "trialing");
  assert.equal(f.state.events.length, 0);
  assert.equal(f.state.writes, 0);
});
test("active subscription with unpaid invoice cannot grant paid handoff", async (t) => {
  const f = fixture();
  f.subscription.status = "active";
  f.subscription.latest_invoice = { ...f.invoice, status: "uncollectible" };
  t.mock.method(globalThis, "fetch", async () => Response.json(f.subscription));
  assert.equal(
    await convertSubscribedTrial(f.tx, "workspace", "test-only"),
    false,
  );
  assert.equal(f.state.writes, 0);
});
test("paid handoff uses original subscription, no proration and stable idempotency key", async (t) => {
  const f = fixture();
  let posts = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts++;
        assert.equal(
          String(url),
          "https://api.stripe.com/v1/subscriptions/sub_trial",
        );
        const body = new URLSearchParams(String(init.body));
        assert.equal(body.get("trial_end"), "now");
        assert.equal(body.get("payment_behavior"), "error_if_incomplete");
        assert.equal(body.get("proration_behavior"), "none");
        assert.equal(
          new Headers(init.headers).get("Idempotency-Key"),
          "trial-credit-handoff:sub_trial:end",
        );
        return Response.json({
          ...f.subscription,
          status: "active",
          latest_invoice: f.invoice,
        });
      }
      return Response.json(f.subscription);
    },
  );
  assert.equal(
    await convertSubscribedTrial(f.tx, "workspace", "test-only"),
    true,
  );
  assert.equal(posts, 1);
  assert.equal(f.state.carry, 1);
});
test("missing subscription or Stripe configuration never calls Stripe", async (t) => {
  const f = fixture();
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not call Stripe");
  });
  assert.equal(await convertSubscribedTrial(f.tx, "workspace"), false);
  f.state.binding = false;
  assert.equal(
    await convertSubscribedTrial(f.tx, "workspace", "test-only"),
    false,
  );
});
