import { createHash } from 'node:crypto';

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function connectionSuccess(kind: 'zernio' | 'google-sheets', siteUrl = process.env.PUBLIC_SITE_URL || 'https://www.piggybot.me') {
  const destination = new URL(kind === 'zernio' ? '/login#accounts' : '/login#imports', siteUrl);
  const script = `const message={type:${JSON.stringify(`piggybot:${kind}-connected`)}};
const origin=${JSON.stringify(destination.origin).replace(/</g,'\\u003c')};
try{window.opener?.postMessage(message,origin)}catch{}
document.getElementById('close-window').addEventListener('click',()=>{
try{window.opener?.postMessage(message,origin);window.opener?.focus()}catch{}
window.close();
setTimeout(()=>{document.getElementById('return-hint').hidden=false},200);
});`;
  const hash = createHash('sha256').update(script).digest('base64');
  return {
    csp: `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; base-uri 'none'; frame-ancestors 'none'`,
    html: `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Account connected · Piggybot</title><style>body{margin:32px;background:#fffaf0;color:#172033;font:16px/1.5 system-ui}main{max-width:560px;margin:auto}button,a{display:inline-block;margin:12px 12px 12px 0;padding:12px;border-radius:8px}button{background:#176b87;color:white;border:0;cursor:pointer}a{color:#176b87}</style><main><h1>Account connected</h1><p>Your account is ready in Piggybot.</p><button id="close-window" type="button">Close this window · 关闭 · Cerrar</button><a href="${escapeHtml(destination.href)}">Return to Piggybot · 返回平台 · Volver</a><p id="return-hint" hidden>This browser does not allow this tab to close automatically. Use the return link or close the tab manually.<br>浏览器不允许自动关闭此标签页，请返回平台或手动关闭。<br>El navegador no permite cerrar esta pestaña. Usa el enlace para volver o ciérrala manualmente.</p></main><script>${script}</script></html>`,
  };
}
