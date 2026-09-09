/**
 * Public gateway used by the website's API-backed forms. A static Vite build
 * cannot serve API requests itself, so deployments that do not reverse-proxy
 * the gateway must provide this build-time URL.
 */
const configuredGatewayUrl = import.meta.env.VITE_GATEWAY_URL?.trim().replace(/\/+$/, '');

export function gatewayApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return configuredGatewayUrl ? `${configuredGatewayUrl}${normalizedPath}` : normalizedPath;
}
