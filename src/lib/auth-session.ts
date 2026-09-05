const ACCESS_TOKEN_KEY = 'piggybot.ownerAccessToken';

export function readSessionAccessToken(): string {
  try {
    const token = window.sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? '';
    if (!token) return '';
    // This is only a UX expiry check. The server still verifies the signature.
    try {
      const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
      if (typeof claims.exp === 'number' && claims.exp > Date.now() / 1000) return token;
    } catch { /* Malformed sessions must return to sign-in. */ }
    window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    return '';
  } catch {
    return '';
  }
}

export function storeSessionAccessToken(token: string): void {
  window.sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearSessionAccessToken(): void {
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
}
