import Home from "./pages/Home";
import PlatformDashboard from "./pages/PlatformDashboard";
import Activation from "./pages/Activation";
import Contact from "./pages/Contact";
import type { Lang } from "./i18n/content";

/** 从 URL 路径段检测语言；根路径保留英文，所有本地化静态页使用显式目录。 */
function detectLang(): Lang {
  const segs = window.location.pathname.split("/").filter(Boolean);
  for (const s of segs) {
    if (s === "zh" || s === "en" || s === "es") return s;
  }
  return "en";
}

export default function App() {
  if (window.location.pathname.startsWith('/app')) return <PlatformDashboard />;
  const localPath = window.location.pathname.replace(/^\/(zh|en|es)(?=\/|$)/, '');
  if (localPath.startsWith('/contact')) return <Contact lang={detectLang()} />;
  if (localPath.startsWith('/activate')) return <Activation lang={detectLang()} />;
  return <Home lang={detectLang()} />;
}
