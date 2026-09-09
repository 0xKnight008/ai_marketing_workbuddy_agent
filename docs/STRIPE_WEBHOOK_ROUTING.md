# Stripe webhook routing and historical trial recovery

Production diagnosis: the affected workspace was `inactive`, with no Stripe binding, no trial timestamps and zero usage. Three checkout-start audit records existed, but no applied billing webhook events. POST to the website's `/webhooks/stripe` returned an Nginx HTML 405; the bare domain redirected to www. A merged application fix cannot retroactively activate this record on its own.

## Routing

Use the canonical HTTPS endpoint `https://www.piggybot.me/api/webhooks/stripe` in Stripe. It is an alias of the same signed raw-body handler and works through the existing `/api/` gateway proxy. Retain `STRIPE_WEBHOOK_SECRET` for that exact Stripe destination; a newly created destination has its own signing secret. Never disable signature verification.

The updated host `nginx-server.conf` example routes `/api/` and legacy `/webhooks/stripe` to 4100, and website traffic to 8001 rather than the unrelated service on 3000. Copy the locations into the actual HTTPS server block, preserve certificate/other site configuration, validate with `nginx -t`, then reload. This PR does not edit or reload production Nginx.

Check routing with an empty unsigned POST (`{}`): the expected response is HTTP 401 JSON `stripe_signature_missing`, not HTML, 301 or 405. This probe deliberately cannot activate a customer. Then verify Stripe's actual event delivery succeeds. Replaying the real checkout event uses the existing webhook deduplication.

## Recover the existing subscription

Sign in as the owner of the affected workspace. In Dashboard → Already subscribed?, enter `sub_1UDKDARuamqOc0msxTGcxCYc` and select Verify existing subscription. The server retrieves current Stripe data, checks workspace metadata, current active/trialing state, original trial dates, configured Price-to-plan mapping and any existing customer/subscription binding before writing the entitlement. It never creates another checkout or charges a customer.

A still-valid trial with no usage displays 30 AI credits. Recovery does not restart the seven-day timer, clear usage, or top up the purchased wallet. An expired/canceled subscription remains blocked. The existing checkout recovery also examines recent recorded checkouts so an abandoned later checkout cannot hide an earlier completed one.

Local mocked recovery and API-route tests cover these invariants; live Stripe confirmation still requires deployment and an authenticated owner action or a verified Stripe webhook replay. No production data is modified by this PR.
