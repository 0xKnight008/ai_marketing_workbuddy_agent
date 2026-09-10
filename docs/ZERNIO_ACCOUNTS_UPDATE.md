# Accounts connection update

The Accounts picker now lists the 14 social posting platforms in Zernio's current API excluding Snapchat and WhatsApp as requested. Existing records are not deleted. Their new connections are rejected server-side, and their cards are hidden from Accounts. Shopify blog articles and advertising-only integrations are not social pipeline destinations and are not included.

X retains API identifier `twitter`. The OAuth popup is now opened synchronously during the user click, avoiding loss of browser activation after an awaited API request. Blocked/closed popups and network errors produce actionable messages and release the busy state.

Zernio can return HTTP 402 with `reason=twitter_passthrough` if the **operator's Zernio account** has no payment method. This is distinct from a customer's Piggybot subscription or AI credit balance. The API now returns a safe specific error instead of an unexplained 500. An operator must resolve this supplier-side billing requirement; code cannot bypass it. No live payment settings were changed and the affected user's exact upstream error remains to be confirmed.

Threads, Reddit and Bluesky are now visible; Discord and Slack use provider-hosted connection/selection screens. Existing supported headless pickers remain enabled. Telegram uses the dedicated access-code API, displays its supplied instructions and expiration, and the user syncs their tenant's accounts after bot confirmation. Never share the Telegram code.

Validate real OAuth with a test workspace after deployment, particularly provider-hosted destination selection and Bluesky credential entry. Automated tests mock the provider; they do not authorize or create real accounts.

API references: https://docs.zernio.com/platforms and https://docs.zernio.com/guides/connecting-accounts and https://docs.zernio.com/platforms/twitter.
