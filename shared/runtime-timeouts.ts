/** Keep each caller alive long enough for its callee to return a bounded result. */
export const MODEL_HTTP_TIMEOUT_MS = 930_000; // LiteLLM's longest configured model timeout is 900s.
export const RUNTIME_REQUEST_TIMEOUT_MS = 960_000;
export const PLATFORM_RUNTIME_TIMEOUT_MS = 1_200_000;
