# Platform admin email login

The old “Platform admin secret” is the operator-configured `BILLING_ADMIN_TOKEN`, not a Stripe or Resend credential. It is no longer required by the browser UI. Legacy bearer + secret API access remains available for break-glass operations; never put this secret in a VITE variable or share it with users.

## Deploy

1. Apply platform migrations, including `0020_admin_email_login.sql`, using the normal deployment migration command. No existing customer or billing data is changed.
2. Set these **platform backend** environment values:

   ```dotenv
   PLATFORM_ADMIN_EMAILS=parastate.io@gmail.com
   PUBLIC_SITE_URL=https://www.piggybot.me
   ```

   Unset/empty allowlist denies every email login. Keep `RESEND_API_KEY` and verified `RESEND_FROM_EMAIL` configured in the backend (the existing `FEEDBACK_FROM_EMAIL` is a fallback). Admin messages use their own plain-text security email, not the newsletter `welcome-email` template.
3. Serve the page and `/api/admin/*` over HTTPS. For Egg behind the trusted HTTPS reverse proxy, set `TRUST_PROXY=true`, forward the correct `X-Forwarded-Proto`, and firewall the backend against direct public access. Do not trust forwarded headers from arbitrary clients. Cookies are always Secure and will not work on plain HTTP.
4. Restart the platform, open `/app/admin`, enter the allowlisted email, then open the email and click **Continue sign-in**. No workspace account is needed. Test in a private window: newsletter list access, sign-out, and rejection of the already-used link.

## Security and operations

- Cryptographically random 256-bit links; only SHA-256 hashes stored in PostgreSQL. Links expire after 10 minutes and are consumed atomically on explicit POST, not when an email scanner opens a GET.
- Independent 30-minute, server-revocable session in `__Host-piggybot_admin` (Secure, HttpOnly, SameSite=Strict, Path=/, no Domain). No browser local/session storage of admin credentials.
- Same-origin checks protect cookie-authenticated writes. Admin cookies do not authenticate workspace endpoints. Global admin access comes only from a server-validated session, not a submitted role or email.
- Request limits: 5 per source IP and 2 per email per 15 minutes, stored centrally. Responses do not disclose allowlist membership or provider failure; response timing is not guaranteed identical. The Fastify legacy server conservatively rate-limits by socket IP behind a proxy.
- Delivery failures appear as `admin.login_link_delivery_failed` in `platform_admin_audit`, without token/link/provider response content. Successful sign-in and admin mutations are audited with the admin email.
- Remove an email from the allowlist and restart to revoke its access immediately, including existing sessions. Protect the administrator mailbox with MFA; email sign-in is not itself MFA.
- The production send and end-to-end mailbox delivery must be verified after deploying the environment settings. Automated tests mock Resend and never send real mail.

References: [OWASP token lifecycle guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email).
