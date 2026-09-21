# V6 production workspace

Implements the approved v6 daily workspace in React, using the existing authenticated gateway instead of demo storage. Entry: `/app`.

- Compact daily overview, independent review and channel pages, searchable report library, in-page report details with browser history.
- English, Spanish and Simplified Chinese UI. Interface language is a local preference; output language is sent with report creation and retained in the queued job and saved report metadata. Quotes and frozen outbound content are never translated by the UI.
- Import preview before paid classification, strict CSV validation, editable errors and retained input. The server remains authoritative for validation, tenant access, billing and processing.
- Explicit approval confirmation showing the server's frozen destination, subject and content. Decisions update the queue and home counters only after a successful API response.
- Mobile navigation, keyboard focus containment, native modal dialogs, skip navigation, reduced motion and forced colors.
- Existing billing, notification rules, feedback, weekly history, topics, Google Sheets, Discord import and publishing readiness remain available.

## Validation

```sh
npm ci
npm run build
npx playwright install --with-deps chromium firefox webkit
npx playwright test
cd ai-runtime && npm ci && npm run typecheck && npm test
cd ../platform && npm ci && npm run typecheck && npm test && npm run test:ui
```

Browser tests use isolated API fixtures and exercise UI actions; they do not prove live provider behavior. `workspace-accessibility.yml` runs all three browser engines on Linux and uploads reports. Local macOS 13 cannot run the current Playwright WebKit build. Test retries are disabled.

The acceptance record will distinguish automated checks, manual review, staging integration and assistive-technology testing. No formal WCAG conformance claim is made solely from axe results. Stripe checkout and third-party OAuth screens require their own evaluation.

Production deployment and merge are outside this PR operation. Staging acceptance uses the environment and test account specified by the owner; credentials and Access PINs must not be committed or recorded in test artifacts.
