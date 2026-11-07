import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceLanguage } from "./useWorkspaceLanguage";
import { WorkspaceDialog } from "./Shell";
type Connection = {
  id: string;
  displayName: string;
  platform: string;
  status: string;
  supported: boolean;
  postsSupported?: boolean;
};
type Coverage = {
  accountId: string;
  displayName?: string;
  complete: boolean;
  inserted?: number;
  duplicates?: number;
  error?: string;
  missingDates?: number;
};
type Scan = {
  id: string;
  status: string;
  batchId: string | null;
  itemCount: number;
  coverage: Coverage[];
  createdAt: string;
  reportId?: string;
  reportStatus?: string;
  analysisError?: string;
  reportError?: string;
};
type Schedule = {
  id?: string;
  name: string;
  goal: string;
  accountIds: string[];
  modelBand: "eco" | "standard" | "flagship";
  language: "en" | "zh" | "es";
  localTime: string;
  timezone: string;
  dailyCredits: number;
  maxItems: number;
  enabled: boolean;
  version?: number;
  nextRunAt?: string;
  lastError?: string;
};
type Props = { token: string; apiBase: string };
function useFeedbackApi({ token, apiBase }: Props) {
  return useCallback(
    async <T,>(
      path: string,
      body?: object,
      method = body ? "POST" : "GET",
    ): Promise<T> => {
      const r = await fetch(apiBase + "/api/feedback" + path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "feedback_request_failed");
      return j;
    },
    [token, apiBase],
  );
}
function feedbackError(code:string, w:(en:string,es:string,zh:string)=>string) {
  const messages:Record<string,[string,string,string]>={
    feedback_x_inbox_disabled:['Enable Inbox for this X account in Zernio X capabilities.','Activa Inbox para esta cuenta de X en Zernio.','请在 Zernio 为这个 X 账号开启账号级 Inbox。'],
    feedback_x_analytics_disabled:['Reading recent X posts requires this account’s Analytics capability. Comment collection uses Inbox separately.','Leer publicaciones recientes de X requiere Analytics. Los comentarios usan Inbox por separado.','读取 X 最近帖文需要该账号的 Analytics 能力；留言采集单独使用 Inbox。'],
    feedback_tiktok_business_required:['TikTok comments require a TikTok for Business connection; recent posts can still be read.','Los comentarios de TikTok requieren una conexión TikTok for Business; las publicaciones recientes siguen disponibles.','TikTok 留言读取需要 TikTok for Business 连接；仍可查看最近帖文。'],
    feedback_reconnect_required:['Reconnect this account: the upstream authorization has expired.','Vuelve a conectar la cuenta: la autorización ha caducado.','上游授权已失效，请重新连接该账号。'],
    feedback_account_permission_required:['The provider denied read access. Check this account’s permissions.','El proveedor denegó la lectura. Revisa los permisos de la cuenta.','上游拒绝读取，请核对该账号的读取权限。'],
    feedback_rate_limited:['The provider rate limit was reached. Retry later.','Se alcanzó el límite del proveedor. Inténtalo más tarde.','触发上游读取频率限制，请稍后重试。'],
    feedback_provider_billing_required:['Review Zernio billing or the X spending cap.','Revisa la facturación de Zernio o el límite de gasto de X.','请检查 Zernio 账单或 X 支出上限。'],
    feedback_platform_limitation:['This connection does not support comment reading.','Esta conexión no permite leer comentarios.','这个连接不支持留言读取。'],
    feedback_platform_restricted:['The provider restricts this feature for the connected account.','El proveedor restringe esta función para la cuenta.','上游限制了该账号使用此读取功能。'],
  };
  const copy=messages[code];return copy?w(...copy):code;
}
type RecentPost={id:string;text:string;url:string|null;publishedAt:string|null};
function RecentPosts({account,api}:{account:Connection;api:ReturnType<typeof useFeedbackApi>}) {
  const {w}=useWorkspaceLanguage();
  const [open,setOpen]=useState(false),[posts,setPosts]=useState<RecentPost[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false}},[]);
  async function load(){setBusy(true);setError('');try{const result=await api<{posts:RecentPost[]}>(`/accounts/${account.id}/posts`);if(live.current)setPosts(result.posts)}catch(e){if(live.current)setError((e as Error).message)}finally{if(live.current)setBusy(false)}}
  return <div className="feedback-post-preview"><button type="button" aria-expanded={open} disabled={busy} onClick={()=>{setOpen(!open);if(!open&&posts===null)void load()}}>{w('View recent posts','Ver publicaciones recientes','查看最近帖文')} · {account.displayName}</button>{open&&<section aria-label={w('Recent posts','Publicaciones recientes','最近帖文')}><p>{w('Up to 25 recent posts. This preview does not import posts as comments or start AI analysis. X reads may incur provider charges.','Hasta 25 publicaciones recientes. Esta vista no las importa como comentarios ni inicia análisis de IA. Las lecturas de X pueden generar cargos.','最多 25 条最近帖文。预览不会把帖文作为留言导入，也不会启动 AI 分析。X 读取可能产生上游费用。')}</p>{busy&&<p role="status">{w('Loading…','Cargando…','读取中…')}</p>}{error&&<p role="alert">{feedbackError(error,w)} <button type="button" onClick={()=>void load()}>{w('Retry','Reintentar','重试')}</button></p>}{posts?.length===0&&<p>{w('The provider returned no recent posts.','El proveedor no devolvió publicaciones recientes.','上游未返回最近帖文。')}</p>}{posts?.map(p=><article key={p.id}><p>{p.text||w('Post without text','Publicación sin texto','无文字帖文')}</p>{p.publishedAt&&<time dateTime={p.publishedAt}>{new Date(p.publishedAt).toLocaleString()}</time>}{p.url&&<a href={p.url} target="_blank" rel="noopener noreferrer">{w('Open original post','Abrir publicación original','打开原帖')}</a>}</article>)}</section>}</div>;
}
function AccountChoices({
  api,
  accounts,
  selected,
  onChange,
}: {
  accounts: Connection[];
  api: ReturnType<typeof useFeedbackApi>;
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const { w } = useWorkspaceLanguage();
  return (
    <fieldset className="feedback-accounts">
      <legend>
        {w("Connected accounts", "Cuentas conectadas", "已连接渠道账号")}
      </legend>
      {!accounts.length && (
        <p>
          {w(
            "Connect a channel in Channels first.",
            "Primero conecta un canal.",
            "请先到渠道账号页面连接渠道。",
          )}
        </p>
      )}
      {accounts.map((a) => (
        <div key={a.id}><label>
          <input
            type="checkbox"
            disabled={!a.supported}
            checked={selected.includes(a.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, a.id]
                  : selected.filter((id) => id !== a.id),
              )
            }
          />
          <span>
            {a.displayName} · {a.platform}
            <small>
              {a.platform==='tiktok' && a.postsSupported ? w('Recent posts are available; comments require TikTok for Business.','Publicaciones disponibles; los comentarios requieren TikTok for Business.','可读取最近帖文；留言需 TikTok for Business 连接。') : a.supported
                ? w(
                    "Read permission checked during collection",
                    "Permiso de lectura verificado al recopilar",
                    "采集时验证读取权限",
                  )
                : a.postsSupported ? w('Recent posts only; comments are unavailable.','Solo publicaciones; comentarios no disponibles.','可读取最近帖文；不支持留言采集。') : w(
                    "Reading unavailable for this connection",
                    "Lectura no disponible en esta conexión",
                    "此连接暂不支持读取",
                  )}
            </small>
          </span>
        </label>{a.postsSupported&&<RecentPosts account={a} api={api}/>}</div>
      ))}
    </fieldset>
  );
}
function ScopeNote() {
  const { w } = useWorkspaceLanguage();
  return (
    <p className="feedback-scope">
      {w(
        "Read public comments from up to 25 recent posts per account. X uses its Inbox feed (recent 30-day posts, often only the first page), without enabling Analytics. Older posts and nested replies may be missing. No private messages. Provider caching can delay results; X reads incur provider charges. Collection uses no AI credits; analysis requires a separate budget.",
        "Lee comentarios públicos de hasta 25 publicaciones recientes por cuenta. X usa su feed Inbox de 30 días, a menudo solo la primera página, sin activar Analytics. Pueden faltar publicaciones antiguas y respuestas anidadas. Sin mensajes privados. La caché puede retrasar resultados y X cobra sus lecturas. Recopilar no consume créditos de IA; el análisis requiere otro presupuesto.",
        "只读采集每个账号最多 25 条最近帖文的公开留言。X 继续使用 Inbox 最近 30 天帖文列表（可能仅首页），不会自动开启 Analytics。较旧帖文与嵌套回复可能遗漏，不读取私信。上游缓存可能延迟结果，X 读取另计上游费用。采集不消耗 AI credits，分析需单独确认预算。",
      )}
    </p>
  );
}
function ScanResult({ scan }: { scan: Scan }) {
  const { w, locale } = useWorkspaceLanguage();
  return (
    <div className="feedback-result" aria-live="polite">
      <strong>
        {w("Collection result", "Resultado de recopilación", "采集结果")} ·{" "}
        {scan.itemCount} {w("new items", "elementos nuevos", "条新内容")}
      </strong>
      <p>
        {new Date(scan.createdAt).toLocaleString(locale)} ·{" "}
        {scan.status === "partial"
          ? w(
              "Partial collection — review coverage before analysis",
              "Recopilación parcial: revisa la cobertura antes de analizar",
              "部分采集完成，请核对范围后再分析",
            )
          : scan.status === "failed"
            ? w("Collection failed", "Recopilación fallida", "采集失败")
            : w("Collection finished", "Recopilación terminada", "采集完成")}
      </p>
      <p className="feedback-scope">{w('Analysis starts with representative evidence, not an exhaustive reading of every comment. All collected originals remain available for follow-up and citation checks.','El análisis comienza con evidencia representativa, no con una lectura exhaustiva. Los originales recopilados se conservan para consultas y citas.','分析先使用代表性证据，并非逐条穷尽所有留言。已采集原文会保留，供后续检索和引用核对。')}</p>
      {scan.coverage.map((c) => (
        <p key={c.accountId}>
          {c.displayName ?? c.accountId} · {c.inserted ?? 0}{" "}
          {w("new", "nuevos", "新增")} · {c.duplicates ?? 0}{" "}
          {w("duplicates skipped", "duplicados omitidos", "重复已跳过")} ·{" "}
          {c.complete
            ? w(
                "Available pages collected",
                "Páginas disponibles recopiladas",
                "可用页面已采集",
              )
            : w("Incomplete", "Incompleto", "未完整采集")}
          {c.error && <span> · {feedbackError(c.error,w)} <code>{c.error}</code></span>}
          {!!c.missingDates && (
            <span>
              {" "}
              · {c.missingDates}{" "}
              {w(
                "items without valid dates skipped",
                "elementos sin fecha válida omitidos",
                "条无有效日期内容已跳过",
              )}
            </span>
          )}
        </p>
      ))}
      {(scan.analysisError || scan.reportError) && (
        <p role="alert">
          {w(
            "Analysis needs attention",
            "El análisis necesita atención",
            "分析需要处理",
          )}{" "}
          · {scan.analysisError || scan.reportError}
        </p>
      )}
    </div>
  );
}
export function FeedbackScan(
  props: Props & { onCollected: (id: string, label: string) => void },
) {
  const { w } = useWorkspaceLanguage(),
    api = useFeedbackApi(props);
  const [accounts, setAccounts] = useState<Connection[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [range, setRange] = useState("since"),
    [limit, setLimit] = useState(500),
    [scan, setScan] = useState<Scan | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [partial, setPartial] = useState(false);
  const nonce = useRef(crypto.randomUUID());
  useEffect(() => {
    let alive = true;
    api<Connection[]>("/accounts")
      .then((a) => {
        if (alive) setAccounts(a);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [api]);
  useEffect(() => {
    if (!scan || !["queued", "running"].includes(scan.status)) return;
    let alive = true;
    const tick = () =>
      api<Scan>("/scans/" + scan.id)
        .then((s) => {
          if (alive) setScan(s);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    const timer = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [scan?.id, scan?.status, api]);
  const active =
    busy || (!!scan && ["queued", "running"].includes(scan.status));
  return (
    <div className="feedback-panel">
      <ScopeNote />
      <AccountChoices api={api}
        accounts={accounts}
        selected={selected}
        onChange={(v) => {
          setSelected(v);
          nonce.current = crypto.randomUUID();
        }}
      />
      <div className="feedback-grid">
        <label>
          {w("Comment period", "Periodo de comentarios", "留言时间范围")}
          <select
            value={range}
            disabled={active}
            onChange={(e) => {
              setRange(e.target.value);
              nonce.current = crypto.randomUUID();
            }}
          >
            <option value="since">
              {w(
                "Since the last collection",
                "Desde la última recopilación",
                "自上次采集起",
              )}
            </option>
            <option value="24h">
              {w("Last 24 hours", "Últimas 24 horas", "过去 24 小时")}
            </option>
            <option value="7d">
              {w("Last 7 days", "Últimos 7 días", "过去 7 天")}
            </option>
          </select>
        </label>
        <label>
          {w("Maximum items", "Máximo de elementos", "最多采集条数")}
          <input
            type="number"
            min={Math.max(1, selected.length)}
            max={2000}
            value={limit}
            disabled={active}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              nonce.current = crypto.randomUUID();
            }}
          />
        </label>
      </div>
      <button
        type="button"
        className="workspace-primary"
        disabled={
          active || !selected.length || limit < selected.length || limit > 2000
        }
        onClick={async () => {
          setBusy(true);
          setError("");
          setPartial(false);
          try {
            const { id } = await api<{ id: string }>("/scans", {
              requestId: nonce.current,
              accountIds: selected,
              range,
              maxItems: limit,
            });
            setScan(await api<Scan>("/scans/" + id));
            nonce.current = crypto.randomUUID();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {active
          ? w("Collecting…", "Recopilando…", "正在采集…")
          : w(
              "Collect channel feedback",
              "Recopilar comentarios",
              "扫描渠道留言",
            )}
      </button>
      {error && (
        <p role="alert">
          {w(
            "Could not complete the request. Retry or check the channel connection.",
            "No se pudo completar. Reintenta o revisa la conexión.",
            "请求未完成，请重试或检查渠道连接。",
          )}{" "}
          <code>{error}</code>
        </p>
      )}
      {scan && !["queued", "running"].includes(scan.status) && (
        <>
          <ScanResult scan={scan} />
          {scan.status === "partial" && (
            <label className="feedback-check">
              <input
                type="checkbox"
                checked={partial}
                onChange={(e) => setPartial(e.target.checked)}
              />
              {w(
                "Analyze only the collected evidence; I understand the gaps.",
                "Analizar solo lo recopilado; entiendo las lagunas.",
                "我理解采集缺口，仅分析已采集的证据。",
              )}
            </label>
          )}
          {scan.itemCount > 0 && scan.batchId ? (
            <button
              type="button"
              disabled={
                scan.status === "failed" ||
                (scan.status === "partial" && !partial)
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  if (scan.status === "partial")
                    await api("/scans/" + scan.id + "/accept", {
                      confirmPartial: true,
                    });
                  props.onCollected(
                    scan.batchId!,
                    w("Channel feedback", "Comentarios de canales", "渠道留言"),
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {w("Confirm goal →", "Confirmar objetivo →", "确认目标 →")}
            </button>
          ) : (
            <p>
              {w(
                "No new evidence. No analysis or AI charge will start.",
                "Sin evidencia nueva. No habrá análisis ni cargo de IA.",
                "没有新增证据，不会启动分析或扣除 AI 额度。",
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
export function ScheduledTasks(
  props: Props & { onReport: (id: string) => void },
) {
  const { w, locale } = useWorkspaceLanguage(),
    api = useFeedbackApi(props);
  const [rows, setRows] = useState<Schedule[]>([]),
    [accounts, setAccounts] = useState<Connection[]>([]),
    [draft, setDraft] = useState<Schedule | null>(null),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<Scan[] | null>(null),
    [historyName, setHistoryName] = useState("");
  const load = useCallback(async () => {
    const [s, a] = await Promise.all([
      api<Schedule[]>("/schedules"),
      api<Connection[]>("/accounts"),
    ]);
    setRows(s);
    setAccounts(a);
  }, [api]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  function edit(s?: Schedule) {
    setError("");
    setConsent(false);
    setDraft(
      s
        ? { ...s, localTime: s.localTime.slice(0, 5) }
        : {
            name: "",
            goal: "",
            accountIds: [],
            modelBand: "standard",
            language: locale,
            localTime: "09:00",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            dailyCredits: 20,
            maxItems: 500,
            enabled: true,
          },
    );
  }
  const patch = (v: Partial<Schedule>) => {
    setDraft((d) => (d ? { ...d, ...v } : d));
    setConsent(false);
  };
  return (
    <div className="feedback-page">
      <p>
        {w(
          "Collect → analyze → save a report, on your schedule. Empty collections skip AI. Incomplete collections or insufficient credits pause the schedule. External delivery always needs approval.",
          "Recopilar → analizar → guardar un informe según tu horario. Sin datos nuevos se omite la IA. Datos incompletos o saldo insuficiente pausan la programación. El envío externo siempre requiere aprobación.",
          "按定时计划采集 → 分析 → 保存报告。无新增数据不调用 AI；采集不完整或额度不足时暂停。外部发送仍需批准。",
        )}
      </p>
      <div className="workspace-button-row">
        <button className="workspace-primary" onClick={() => edit()}>
          {w("New scheduled task", "Nueva tarea programada", "新建定时任务")}
        </button>
        <button onClick={() => void load().catch((e) => setError(e.message))}>
          {w("Refresh", "Actualizar", "刷新")}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!rows.length && (
        <section className="workspace-card">
          <h2>
            {w(
              "No scheduled tasks yet",
              "Aún no hay tareas programadas",
              "暂无定时任务",
            )}
          </h2>
          <p>
            {w(
              "Choose channels, a goal and a daily credit ceiling to begin.",
              "Elige canales, un objetivo y un límite diario de créditos.",
              "选择渠道、分析目标和每日额度上限后即可开始。",
            )}
          </p>
        </section>
      )}
      {rows.map((s) => (
        <article className="workspace-card" key={s.id}>
          <h2>{s.name}</h2>
          <p>{s.goal}</p>
          <p>
            {s.enabled
              ? w("Active", "Activa", "运行中")
              : s.lastError
                ? w("Needs attention", "Requiere atención", "需要处理")
                : w("Paused", "Pausada", "已暂停")}{" "}
            · {s.localTime.slice(0, 5)} · {s.timezone} · {s.modelBand}
          </p>
          <p>
            {w("Daily ceiling", "Límite diario", "每日上限")} {s.dailyCredits}{" "}
            credits · {w("Up to", "Hasta", "最多")} {s.maxItems}{" "}
            {w("items", "elementos", "条")}
          </p>
          {s.enabled && s.nextRunAt && (
            <p>
              {w("Next collection", "Próxima recopilación", "下次采集")} ·{" "}
              {new Date(s.nextRunAt).toLocaleString(locale, {
                timeZone: s.timezone,
              })}
            </p>
          )}
          {s.lastError && <p role="alert">{s.lastError}</p>}
          <div className="workspace-button-row">
            <button onClick={() => edit(s)}>
              {s.enabled
                ? w("Edit", "Editar", "编辑")
                : w("Review & resume", "Revisar y reanudar", "核对并恢复")}
            </button>
            {s.enabled && (
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api("/schedules/" + s.id + "/pause", {
                      expectedVersion: s.version,
                    });
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {w("Pause", "Pausar", "暂停")}
              </button>
            )}
            <button
              onClick={async () => {
                try {
                  setHistory(
                    await api<Scan[]>("/schedules/" + s.id + "/history"),
                  );
                  setHistoryName(s.name);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {w("Run history", "Historial de ejecuciones", "运行记录")}
            </button>
          </div>
        </article>
      ))}
      {draft && (
        <WorkspaceDialog
          title={
            draft.id
              ? w(
                  "Edit scheduled task",
                  "Editar tarea programada",
                  "编辑定时任务",
                )
              : w(
                  "New scheduled task",
                  "Nueva tarea programada",
                  "新建定时任务",
                )
          }
          onClose={() => {
            if (!busy) setDraft(null);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!consent || busy) return;
              setBusy(true);
              setError("");
              try {
                const { id, version, nextRunAt, lastError, ...body } = draft;
                await api(
                  "/schedules" + (id ? "/" + id : ""),
                  { ...body, consent: true, expectedVersion: version },
                  id ? "PUT" : "POST",
                );
                setDraft(null);
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {w("Name", "Nombre", "名称")}
              <input
                required
                maxLength={120}
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <ScopeNote />
            <AccountChoices api={api}
              accounts={accounts}
              selected={draft.accountIds}
              onChange={(accountIds) => patch({ accountIds })}
            />
            <label>
              {w("Analysis goal", "Objetivo del análisis", "分析目标")}
              <textarea
                required
                maxLength={4000}
                rows={4}
                value={draft.goal}
                onChange={(e) => patch({ goal: e.target.value })}
              />
            </label>
            <div className="feedback-grid">
              <label>
                {w("Daily at", "Cada día a las", "每日时间")}
                <input
                  type="time"
                  required
                  value={draft.localTime}
                  onChange={(e) => patch({ localTime: e.target.value })}
                />
              </label>
              <label>
                {w("Timezone", "Zona horaria", "时区")}
                <input
                  required
                  value={draft.timezone}
                  onChange={(e) => patch({ timezone: e.target.value })}
                />
              </label>
              <label>
                {w("Model", "Modelo", "模型")}
                <select
                  value={draft.modelBand}
                  onChange={(e) =>
                    patch({
                      modelBand: e.target.value as Schedule["modelBand"],
                    })
                  }
                >
                  {["eco", "standard", "flagship"].map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </label>
              <label>
                {w("Report language", "Idioma del informe", "报告语言")}
                <select
                  value={draft.language}
                  onChange={(e) =>
                    patch({ language: e.target.value as Schedule["language"] })
                  }
                >
                  <option value="en">English</option>
                  <option value="zh">简体中文</option>
                  <option value="es">Español</option>
                </select>
              </label>
              <label>
                {w(
                  "Daily credit ceiling",
                  "Límite diario de créditos",
                  "每日额度上限",
                )}
                <input
                  type="number"
                  min={1}
                  max={10000}
                  required
                  value={draft.dailyCredits}
                  onChange={(e) =>
                    patch({ dailyCredits: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                {w("Maximum items", "Máximo de elementos", "最多采集条数")}
                <input
                  type="number"
                  min={Math.max(1, draft.accountIds.length)}
                  max={2000}
                  required
                  value={draft.maxItems}
                  onChange={(e) => patch({ maxItems: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="feedback-check">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => patch({ enabled: e.target.checked })}
              />
              {w("Enable schedule", "Activar programación", "启用定时任务")}
            </label>
            <p>
              {w(
                "Analysis uses representative evidence that fits the confirmed budget. Actual charges depend on usage, up to this ceiling. No automatic model downgrade or top-up.",
                "El análisis usa evidencia representativa dentro del presupuesto. El cargo real depende del uso, hasta este límite. Sin cambio automático de modelo ni recarga.",
                "分析使用预算内可容纳的代表性证据，按实际用量结算且不超过上限；不会自动降档或充值。",
              )}
            </p>
            <label className="feedback-check">
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              {w(
                "I authorize recurring collection and analysis within this daily ceiling.",
                "Autorizo la recopilación y el análisis recurrentes dentro de este límite diario.",
                "我授权按此计划重复采集和分析，并遵守每日额度上限。",
              )}
            </label>
            {error && <p role="alert">{error}</p>}
            <button
              className="workspace-primary"
              disabled={busy || !consent || !draft.accountIds.length}
            >
              {busy
                ? w("Saving…", "Guardando…", "保存中…")
                : w("Save schedule", "Guardar programación", "保存定时任务")}
            </button>
          </form>
        </WorkspaceDialog>
      )}
      {history && (
        <WorkspaceDialog title={historyName} onClose={() => setHistory(null)}>
          {!history.length && (
            <p>{w("No runs yet.", "Sin ejecuciones.", "暂无运行记录。")}</p>
          )}
          {history.map((s) => (
            <article className="workspace-card" key={s.id}>
              <ScanResult scan={s} />
              {s.status === "partial" && s.itemCount > 0 && (
                <AcceptCollectedEvidence
                  scan={s}
                  token={props.token}
                  apiBase={props.apiBase}
                />
              )}
              {s.reportId && (
                <button
                  onClick={() => {
                    setHistory(null);
                    props.onReport(s.reportId!);
                  }}
                >
                  {w("Open report", "Abrir informe", "打开报告")} ·{" "}
                  {s.reportStatus}
                </button>
              )}
            </article>
          ))}
        </WorkspaceDialog>
      )}
    </div>
  );
}

function AcceptCollectedEvidence({
  scan,
  token,
  apiBase,
}: Props & { scan: Scan }) {
  const { w } = useWorkspaceLanguage(),
    api = useFeedbackApi({ token, apiBase });
  const [confirmed, setConfirmed] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (saved)
    return (
      <p role="status">
        {w(
          "Evidence is now available under Current task → Reuse imported data. Confirm a goal and budget to analyze it.",
          "La evidencia está disponible en Tarea actual → Reutilizar datos. Confirma un objetivo y presupuesto para analizarla.",
          "证据已可在「当前任务 → 复用已导入数据」选择；确认目标和预算后再分析。",
        )}
      </p>
    );
  return (
    <div>
      <label className="feedback-check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {w(
          "I accept the incomplete coverage shown above.",
          "Acepto la cobertura incompleta indicada arriba.",
          "我已核对并接受上述采集缺口。",
        )}
      </label>
      <button
        disabled={!confirmed || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api("/scans/" + scan.id + "/accept", {
              confirmPartial: true,
            });
            setSaved(true);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {w(
          "Make evidence available for a new task",
          "Habilitar evidencia para otra tarea",
          "将证据用于新任务",
        )}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
