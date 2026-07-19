import Home from "./pages/Home";
import type { Lang } from "./i18n/content";

/** 从 URL 路径段检测语言（兼容任意部署子路径）：/en /es 为对应语言，其余默认中文 */
function detectLang(): Lang {
  const segs = window.location.pathname.split("/").filter(Boolean);
  for (const s of segs) {
    if (s === "en" || s === "es") return s;
  }
  return "zh";
}

export default function App() {
  return <Home lang={detectLang()} />;
}
