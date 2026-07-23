import Home from "./pages/Home";
import type { Lang } from "./i18n/content";

/** 从 URL 路径段检测语言（兼容任意部署子路径）：/zh、/es 为对应语言，其余默认英文。 */
function detectLang(): Lang {
  const segs = window.location.pathname.split("/").filter(Boolean);
  for (const s of segs) {
    if (s === "zh" || s === "es") return s;
  }
  return "en";
}

export default function App() {
  return <Home lang={detectLang()} />;
}
