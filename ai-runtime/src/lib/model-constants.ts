/** Shared wire-model constants for official direct channels. No internal imports. */

export const KIMI_WIRE_MODEL = 'kimi-k3.1-pro';

// K3 series fixes temperature/top_p/n/penalties server-side. Sending any other
// value returns invalid_request_error, so the transport must strip them.
export const FIXED_PARAM_MODELS: ReadonlySet<string> = new Set([KIMI_WIRE_MODEL]);
