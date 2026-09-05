/** Parse before trusting: browsers normalize backslashes and control characters. */
export function safeNextPath(search: string, origin: string): string {
  const next = new URLSearchParams(search).get('next') ?? '';
  if (!next.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(next)) return '';
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin || url.pathname.startsWith('//') || /^\/(?:login|register)\/?$/.test(url.pathname)) return '';
    if (url.pathname.startsWith('/app') && url.searchParams.has('next')) return '';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return ''; }
}

export function checkoutAuthPath(pathname: string, search: string, plan: string): string {
  const params = new URLSearchParams(search);
  params.set('plan', plan);
  return `/login?next=${encodeURIComponent(`${pathname}?${params}`)}`;
}

/** A 403 is a permission failure, not necessarily an expired session. */
export function requiresReauthentication(status: number): boolean { return status === 401; }
