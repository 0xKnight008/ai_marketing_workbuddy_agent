# Google Business connection recovery

The Zernio callback `error=no_google_locations` is now distinguished from a generic
OAuth denial. After validating the signed state and workspace/profile binding,
the callback returns a non-cacheable recovery page with HTTP 409 and instructions
to check the Google account's access to its Business Profile locations.

This does not create or verify a Google Business location and is independent of
Google Sheets authorization. The account owner must resolve missing location
access in Google Business Profile before reconnecting from Accounts.

No accounts are synchronized on an error callback. Missing/invalid state and other
provider errors retain their existing error handling. The recovery page never
echoes the signed state and suppresses referrer transmission.

Verification: platform typecheck, full platform tests, and HTTP callback tests for
the recovery page and state non-disclosure. No production OAuth callback replayed.
