/** Google Form that collects newsletter sign-ups (responses land in the linked Google Sheet). */
export const GOOGLE_FORM_ID =
  "1FAIpQLSf0snTCY6aXd-eREWUYHvfHUPsdAxRLiCW2KxJanUQomT0ncA";

/**
 * The Google Forms email field ID, without its `entry.` prefix.
 * Leave this empty to use the embedded-form fallback instead.
 */
export const GOOGLE_FORM_EMAIL_ENTRY = "1237653730";

/** Embedded-form fallback. */
export const GOOGLE_FORM_EMBED_URL = `https://docs.google.com/forms/d/e/${GOOGLE_FORM_ID}/viewform?embedded=true`;
