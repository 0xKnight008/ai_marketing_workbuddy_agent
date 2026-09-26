/** Read the public site's HttpOnly cookie through its same-origin API proxy.
 * The resulting non-secret code can accompany Checkout on a separate API host. */
export async function checkoutReferral(explicit: string | undefined, token: string): Promise<string | undefined> {
  if (explicit) return explicit;
  try {
    const response = await fetch('/api/referral/context', {
      headers: { authorization: `Bearer ${token}` }, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return undefined;
    const value = await response.json() as { referralCode?: unknown };
    return typeof value.referralCode === 'string' && /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(value.referralCode) ? value.referralCode : undefined;
  } catch { return undefined; }
}
