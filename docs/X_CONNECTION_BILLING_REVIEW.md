# X connection and billing boundary

## Diagnosis (2026-09-28)

The main-branch Accounts connect button, authenticated gateway and
PlatformService.connectUrl do not consult customer credits or subscription
entitlements. They check connection-management permissions, resolve the tenant
profile and request GET /v1/connect/twitter. SupplierBillingError is raised only
when the provider responds with HTTP 402. No local deposit gate exists here.

Zernio's published guide currently documents twitter_passthrough when the
provider team has no payment method; this is not a customer AI-credit deposit:
https://docs.zernio.com/guides/connecting-accounts
https://docs.zernio.com/platforms/twitter/reference

The affected live request has not been captured, so the exact production cause
is not confirmed. If support says this requirement was removed, ask them to
inspect the team bound to the deployed API key and the failed connect request.
Do not share the API key, OAuth state, credentials or authorization headers.

## Changes and safety

- Keep initial connections independent of customer billing, covered by a test
  that permits only the tenant-profile query and rejects all billing queries.
- Distinguish provider connection billing restrictions with public error
  zernio_connection_billing_restricted. No raw provider payload is exposed.
- Show explicit guidance that buying Piggybot credits cannot fix an upstream
  OAuth restriction. Do not invent an auth URL or mark the account connected.
- Retain publish-time projectedActionUsage and AI reservation checks. The new
  regression confirms X publishing is paused for exhausted trial credits.
- Do not introduce a second AI-credit charge for text publishing: existing task
  quota/supplier spend and paid-work retry semantics remain unchanged.

## Staging acceptance

With an owner/admin account at zero credits, start X Connect and verify that the
request reaches Zernio. A valid authUrl must open OAuth; a provider 402 must show
the provider-specific diagnostic, not a customer top-up requirement. Complete
OAuth and verify the returned account identity and health. Separately verify
that an exhausted trial cannot initiate a new publish. No live connections or
posts were made as part of this patch.
