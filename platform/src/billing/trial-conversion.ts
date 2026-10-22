import type { TenantTransaction } from "../foundation/database";
import { usageSnapshot } from "./guardrails";

type Billing = {
  customerId: string | null;
  subscriptionId: string | null;
  priceId: string | null;
  status: string;
  handoffAt: string | null;
  trialEndsAt: string | null;
};
const record = (v: unknown): Record<string, any> =>
  v && typeof v === "object" ? (v as Record<string, any>) : {};
/** Ends an existing subscribed trial only. Never creates subscriptions or changes
 * prices. Stripe payment and all local allocations have independent stable keys,
 * so retries after timeouts/webhook races cannot charge or replenish twice. */
export async function convertSubscribedTrial(
  tx: TenantTransaction,
  workspaceId: string,
  secret?: string,
  trialWasActive?: boolean,
  retryId?: string,
): Promise<boolean> {
  if (!secret) return false;
  const found =
    await tx.query<Billing>(`SELECT stripe_customer_id AS "customerId", stripe_subscription_id AS "subscriptionId",
    stripe_price_id AS "priceId", subscription_status AS status, trial_credit_handoff_at::text AS "handoffAt", trial_ends_at::text AS "trialEndsAt"
    FROM workspace_billing WHERE workspace_id=current_setting('app.workspace_id')::uuid FOR UPDATE`);
  const binding = found.rows[0];
  if (
    !binding?.customerId ||
    !binding.subscriptionId ||
    !binding.priceId ||
    !["trialing", "active"].includes(binding.status)
  )
    return false;
  const request = async (
    path: string,
    body?: URLSearchParams,
    operation = "end",
  ) => {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${secret}`,
        ...(body
          ? {
              "content-type": "application/x-www-form-urlencoded",
              "Idempotency-Key": `trial-credit-handoff:${binding.subscriptionId}:${operation}${retryId ? `:${retryId}` : ""}`,
            }
          : {}),
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    return record(await response.json());
  };
  const path = `subscriptions/${encodeURIComponent(binding.subscriptionId)}`;
  const valid = (s: Record<string, any> | null) =>
    !!s &&
    s.id === binding.subscriptionId &&
    s.customer === binding.customerId &&
    s.metadata?.workspaceId === workspaceId &&
    s.items?.data?.length === 1 &&
    s.items.data[0]?.price?.id === binding.priceId;
  let subscription = await request(`${path}?expand[]=latest_invoice`);
  if (!valid(subscription)) return false;
  if (subscription!.status === "trialing") {
    if (
      subscription!.cancel_at_period_end ||
      subscription!.cancel_at ||
      subscription!.pause_collection ||
      subscription!.schedule ||
      subscription!.collection_method !== "charge_automatically"
    )
      return false;
    subscription = await request(
      path,
      new URLSearchParams({
        trial_end: "now",
        payment_behavior: "error_if_incomplete",
        proration_behavior: "none",
        "expand[]": "latest_invoice",
      }),
    );
    if (!valid(subscription)) return false;
  }
  if (subscription!.status !== "active") return false;
  // Active alone isn't proof that the first non-trial invoice was paid.
  let invoice = record(subscription!.latest_invoice);
  const invoiceSubscription =
    invoice.subscription ?? invoice.parent?.subscription_details?.subscription;
  if (
    !invoice.id ||
    invoice.customer !== binding.customerId ||
    invoiceSubscription !== binding.subscriptionId ||
    !["subscription_cycle", "subscription_update"].includes(
      invoice.billing_reason,
    )
  )
    return false;
  if (invoice.status === "draft")
    invoice = record(
      await request(
        `invoices/${encodeURIComponent(invoice.id)}/finalize`,
        new URLSearchParams({ auto_advance: "false" }),
        "finalize",
      ),
    );
  if (invoice.status === "open")
    invoice = record(
      await request(
        `invoices/${encodeURIComponent(invoice.id)}/pay`,
        new URLSearchParams(),
        "pay",
      ),
    );
  if (invoice.status !== "paid") return false;
  // Preserve only genuinely unused free credits, and only once. Trial events
  // remain identifiable even if a Stripe webhook has already changed the status.
  const applied = await tx.query(
    `UPDATE workspace_billing b SET subscription_status='active',trial_credit_handoff_pending=false,
    trial_credit_carryover=CASE WHEN trial_credit_handoff_at IS NULL AND $1::boolean THEN
      LEAST(30,GREATEST(0,30-COALESCE((SELECT SUM(CASE WHEN e.status='reversed' THEN -e.trial_ai_credits ELSE e.trial_ai_credits END)
       FROM task_event e WHERE e.workspace_id=b.workspace_id AND e.created_at>=b.trial_started_at),0))) ELSE trial_credit_carryover END,
    trial_credit_handoff_at=COALESCE(trial_credit_handoff_at,now()),updated_at=now()
    WHERE b.workspace_id=current_setting('app.workspace_id')::uuid RETURNING workspace_id`,
    [trialWasActive ?? Date.parse(binding.trialEndsAt ?? "") > Date.now()],
  );
  if (!binding.handoffAt && applied.rowCount)
    await tx.query(
      `INSERT INTO audit_event(workspace_id,event_type,payload) VALUES($1,'billing.trial_credit_handoff',$2)`,
      [
        workspaceId,
        { subscriptionId: binding.subscriptionId, invoiceId: invoice.id },
      ],
    );
  return (await usageSnapshot(tx)).subscriptionStatus === "active";
}
