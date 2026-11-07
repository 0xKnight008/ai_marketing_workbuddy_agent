import { useEffect, useState } from "react";
import { useWorkspaceLanguage } from "./useWorkspaceLanguage";
type Mode = "system" | "light" | "dark";
export function Appearance() {
  const { w } = useWorkspaceLanguage();
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const s = localStorage.getItem("piggybot.appearance");
      return s === "light" || s === "dark" ? s : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.dataset.workspaceTheme =
        mode === "system" ? (media.matches ? "dark" : "light") : mode;
    };
    update();
    media.addEventListener("change", update);
    try {
      localStorage.setItem("piggybot.appearance", mode);
    } catch {}
    return () => {
      media.removeEventListener("change", update);
      delete document.documentElement.dataset.workspaceTheme;
    };
  }, [mode]);
  return (
    <select
      aria-label={w("Appearance", "Apariencia", "外观显示")}
      value={mode}
      onChange={(e) => setMode(e.target.value as Mode)}
    >
      <option value="system">{w("System", "Sistema", "跟随系统")}</option>
      <option value="light">☀ {w("Light", "Claro", "浅色")}</option>
      <option value="dark">☾ {w("Dark", "Oscuro", "暗夜")}</option>
    </select>
  );
}
