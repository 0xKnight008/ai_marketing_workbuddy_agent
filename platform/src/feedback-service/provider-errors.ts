/** Allowlisted public codes only; never expose supplier bodies or credentials. */
export function feedbackProviderError(status: number, code?: unknown, platform?: string): string {
  switch (code) {
    case 'X_INBOX_NOT_ENABLED': return 'feedback_x_inbox_disabled';
    case 'X_ANALYTICS_NOT_ENABLED': return 'feedback_x_analytics_disabled';
    case 'TOKEN_EXPIRED':
    case 'reconnect_required':
    case 'linkedin_reconnect_required': return 'feedback_reconnect_required';
    case 'PLATFORM_LIMITATION': return platform === 'tiktok' ? 'feedback_tiktok_business_required' : 'feedback_platform_limitation';
    case 'PLATFORM_BETA_RESTRICTED': return 'feedback_platform_restricted';
  }
  if (status === 401 || status === 403) return 'feedback_account_permission_required';
  if (status === 429) return 'feedback_rate_limited';
  if (status === 402) return 'feedback_provider_billing_required';
  return 'feedback_source_unavailable';
}
