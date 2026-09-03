const ACCESS_TOKEN_KEY = 'piggybot.ownerAccessToken';

export function readSessionAccessToken(): string {
  try {
    return window.sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? '';
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
