import Home from "./pages/Home";
import PlatformDashboard from "./pages/PlatformDashboard";
import Activation from "./pages/Activation";
import Contact from "./pages/Contact";
import Legal from "./pages/Legal";
import type { Lang } from "./i18n/content";

const REFERRAL_CODE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

/** 从 URL 路径段检测语言；根路径保留英文，所有本地化静态页使用显式目录。 */
function detectLang(): Lang {
  const segs = window.location.pathname.split("/").filter(Boolean);
  for (const s of segs) {
    if (s === "zh" || s === "en" || s === "es") return s;
  }
  return "en";
}

/** Resolve the public referral short-link to the checkout route. */
function referralDestination(path: string): string | undefined {
  const match = path.match(/^\/r\/([^/]+)\/?$/);
  if (!match) return undefined;

  const code = match[1].toUpperCase();
  return REFERRAL_CODE.test(code) ? `/activate?ref=${encodeURIComponent(code)}` : undefined;
}

export default function App() {
  if (window.location.pathname.startsWith('/app')) return <PlatformDashboard />;
  const localPath = window.location.pathname.replace(/^\/(zh|en|es)(?=\/|$)/, '');
  const referralUrl = referralDestination(localPath);
  if (referralUrl) {
    window.location.replace(referralUrl);
    return null;
  }
  if (localPath.startsWith('/contact')) return <Contact lang={detectLang()} />;
  if (localPath.startsWith('/activate')) return <Activation lang={detectLang()} />;
  if (localPath.startsWith('/privacy')) return <Legal lang={detectLang()} kind="privacy" />;
  if (localPath.startsWith('/terms')) return <Legal lang={detectLang()} kind="terms" />;
  return <Home lang={detectLang()} />;
}
