import officialLogo from "../assets/piggybot-logo.png";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Sprout,
  SquareCheck,
  BookOpen,
  Link,
  Send,
  Activity,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Bell,
  Search,
  CircleHelp,
  LogOut,
} from "lucide-react";
import { useWorkspaceLanguage } from "./useWorkspaceLanguage";
import "./workspace.css";
import { sections, type Section } from "./routes";
import { primarySections } from "./routes";
import "./workspace-b.css";
function useSectionLabels() {
  const { w } = useWorkspaceLanguage();
  return {
    start: w("Current task", "Tarea actual", "当前任务"),
    review: w("Review & schedule", "Revisión y programación", "审核与排期"),
    reports: w("Report library", "Informes", "报告库"),
    pipelines: w("Publish", "Publicar", "发布"),
    accounts: w("Channels", "Canales", "渠道账号"),
    activity: w("Activity", "Actividad", "活动"),
    settings: w("Settings & usage", "Ajustes y consumo", "设置与用量"),
  };
}
const icons = {
  start: Sprout,
  review: SquareCheck,
  reports: BookOpen,
  pipelines: Send,
  accounts: Link,
  activity: Activity,
  settings: Settings,
};
export function WorkspaceShell({
  section,
  navigate,
  name,
  email,
  pending,
  usage,
  signOut,
  support,
  children,
}: {
  section: Section;
  navigate: (s: Section) => void;
  name: string;
  email: string;
  pending: number;
  usage: { taskUsed: number; taskQuota: number } | null;
  signOut: () => void;
  support?: ReactNode;
  children: ReactNode;
}) {
  const { locale, setLocale, w } = useWorkspaceLanguage();
  const labels = useSectionLabels();
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width:760px)").matches,
  );
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("piggybot.sidebar.collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const media = matchMedia("(max-width:760px)");
    const change = () => {
      setMobile(media.matches);
      setMenu(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  function toggleSidebar() {
    if (mobile) {
      if (menu) closeMenu();
      else setMenu(true);
    } else {
      setCollapsed((v) => {
        try {
          localStorage.setItem("piggybot.sidebar.collapsed", String(!v));
        } catch {}
        return !v;
      });
    }
  }
  const compact = mobile ? !menu : collapsed;
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("");
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(section);
  const restoreMenuFocus = useRef(false);
  function closeMenu() {
    restoreMenuFocus.current = true;
    setMenu(false);
  }
  useEffect(() => {
    if (!menu && restoreMenuFocus.current) {
      restoreMenuFocus.current = false;
      menuButton.current?.focus();
    }
  }, [menu]);
  useEffect(() => {
    if (previous.current !== section) {
      heading.current?.focus();
      previous.current = section;
    }
  }, [section]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = sidebar.current;
    menuButton.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMenu();
      }
      if (e.key === "Tab" && panel) {
        const items = Array.from(
          panel.querySelectorAll<HTMLElement>("button,a,select"),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0]?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      window.removeEventListener("keydown", key);
    };
  }, [menu]);
  function go(s: Section) {
    setMenu(false);
    navigate(s);
  }
  return (
    <div
      className={`workspace-v6 workspace-shell ${compact ? "sidebar-compact" : ""} ${menu ? "sidebar-overlay" : ""}`}
    >
      <a className="skip-link" href="#workspace-content">
        {w("Skip to content", "Saltar al contenido", "跳至主要内容")}
      </a>
      {menu && (
        <div
          className="workspace-scrim"
          onClick={() => {
            closeMenu();
          }}
        />
      )}
      <aside
        ref={sidebar}
        className={`workspace-sidebar ${menu ? "is-open" : ""}`}
        aria-label={w(
          "Workspace navigation",
          "Navegación del espacio",
          "工作区导航",
        )}
      >
        <div className="workspace-sidebar-head">
          <a className="workspace-brand" href="/" aria-label="Piggybot">
            <img src={officialLogo} alt="" />
            <span>
              Piggybot
              <small>
                {w(
                  "Your thoughtful work buddy",
                  "Tu compañero de trabajo",
                  "你的贴心工作伙伴",
                )}
              </small>
            </span>
          </a>
          <button
            ref={menuButton}
            className="sidebar-toggle"
            onClick={toggleSidebar}
            aria-controls="workspace-navigation"
            aria-expanded={!compact}
            aria-label={
              compact
                ? w("Expand navigation", "Expandir navegación", "展开导航")
                : w("Collapse navigation", "Contraer navegación", "收起导航")
            }
            title={
              compact
                ? w("Expand navigation", "Expandir navegación", "展开导航")
                : w("Collapse navigation", "Contraer navegación", "收起导航")
            }
          >
            {compact ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
        </div>
        <div className="workspace-name">
          <strong>{name}</strong>
          <small>
            {w("Your workspace", "Tu espacio de trabajo", "你的工作区")}
          </small>
        </div>
        <nav id="workspace-navigation">
          {primarySections.map((id) => {
            const Icon = icons[id];
            return (
              <button
                key={id}
                data-nav={id}
                aria-label={labels[id]}
                title={compact ? labels[id] : undefined}
                aria-current={section === id ? "page" : undefined}
                onClick={() => go(id)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{labels[id]}</span>
                {id === "review" && pending > 0 && <b>{pending}</b>}
              </button>
            );
          })}
        </nav>
        {usage && (
          <div className="workspace-meter">
            <span>{w("Task usage", "Uso de tareas", "任务用量")}</span>
            <progress
              aria-label={w("Task usage", "Uso de tareas", "任务用量")}
              max={Math.max(usage.taskQuota, 1)}
              value={usage.taskUsed}
            />
            <small>
              {usage.taskUsed.toLocaleString(locale)} /{" "}
              {usage.taskQuota.toLocaleString(locale)}
            </small>
          </div>
        )}
        <footer>
          <button
            aria-label={w("Help", "Ayuda", "帮助")}
            title={w("Help", "Ayuda", "帮助")}
            onClick={() => {
              setMenu(false);
              window.dispatchEvent(new Event("piggybot:open-support"));
            }}
          >
            <CircleHelp size={16} />
            <span>{w("Help", "Ayuda", "帮助")}</span>
          </button>
          <button
            aria-label={w("Sign out", "Cerrar sesión", "退出登录")}
            title={w("Sign out", "Cerrar sesión", "退出登录")}
            onClick={signOut}
          >
            <LogOut size={16} />
            <span>{w("Sign out", "Cerrar sesión", "退出登录")}</span>
          </button>
          <small>{email}</small>
        </footer>
      </aside>
      <div className="workspace-main" inert={menu}>
        <header className="workspace-topbar">
          <span className="workspace-breadcrumb">
            {name} <span>/</span> {labels[section]}
          </span>
          <div className="workspace-toolbar">
            <button
              onClick={() => setSearch(true)}
              aria-label={w(
                "Search workspace",
                "Buscar en el espacio",
                "查找工作区",
              )}
            >
              <Search size={17} />
              <span className="desktop-only">
                {w("Find something…", "Buscar…", "查找内容…")}
              </span>
              <kbd className="desktop-only">⌘ K</kbd>
            </button>
            <label className="sr-only" htmlFor="workspace-language">
              {w("Interface language", "Idioma de la interfaz", "界面语言")}
            </label>
            <select
              id="workspace-language"
              value={locale}
              onChange={(e) => setLocale(e.target.value as typeof locale)}
            >
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="zh">简体中文</option>
            </select>
            <button
              aria-label={w(
                "Review pending items",
                "Revisar pendientes",
                "审核待处理事项",
              )}
              onClick={() => go("review")}
            >
              <Bell size={19} />
              {pending > 0 && <b>{pending}</b>}
            </button>
          </div>
        </header>
        <main id="workspace-content" tabIndex={-1}>
          <h1 ref={heading} tabIndex={-1}>
            {labels[section]}
          </h1>
          {children}
        </main>
      </div>
      <div inert={menu}>{support}</div>
      {search && (
        <WorkspaceDialog
          title={w(
            "Find your next step",
            "Encuentra tu siguiente paso",
            "查找下一步",
          )}
          onClose={() => setSearch(false)}
        >
          <label htmlFor="workspace-search">
            {w("Search pages", "Buscar páginas", "搜索页面")}
          </label>
          <input
            autoFocus
            id="workspace-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="search-results">
            {sections
              .filter((id) =>
                labels[id]
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()),
              )
              .map((id) => (
                <button
                  key={id}
                  onClick={() => {
                    setSearch(false);
                    go(id);
                  }}
                >
                  {labels[id]}
                </button>
              ))}
          </div>
        </WorkspaceDialog>
      )}
    </div>
  );
}
export function WorkspaceDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const { w } = useWorkspaceLanguage();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus();
      else
        document.querySelector<HTMLElement>("#workspace-content h1")?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="workspace-dialog workspace-v6"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby={titleId}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button onClick={onClose} aria-label={w("Close", "Cerrar", "关闭")}>
          <X aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
