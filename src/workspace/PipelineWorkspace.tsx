import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceLanguage } from "./useWorkspaceLanguage";
import { t } from "./translate";
import { ExecutionHistory } from "./ModelControls";
import { RunDiagnostics, type RunDetails } from "./WorkflowRunDetails";
import type { WorkspaceApproval } from "./Overview";
import { supportsAnnouncement } from "../../platform/src/zernio/social-platforms";
import "./pipeline.css";

type Band = "eco" | "standard" | "flagship";
export type PipelineEntry = {
  id: string;
  name: string;
  status: string;
  version: number;
  lastRunId?: string | null;
  lastRunStatus?: string;
  definition: {
    brief: string;
    sourceText?: string;
    goal?: string;
    targetAccountIds: string[];
    modelBand?: Band;
    tone: string;
    language: string;
  };
};
type Account = {
  id: string;
  externalAccountId: string;
  displayName: string;
  platform: string;
  status: string;
  capabilities: string[];
};
type Draft = {
  name: string;
  sourceText: string;
  goal: string;
  targetAccountIds: string[];
  modelBand: Band;
  tone: string;
  language: string;
};
type Quote = {
  mode: string;
  quoteId?: string;
  estimatedCredits: number;
  maxCredits: number;
  expiresAt?: string;
  subscriptionPaymentRequired?: boolean;
};
type Run = RunDetails & { workflowId: string };
const terminal = (status: string) =>
  ["succeeded", "failed", "cancelled", "timed_out", "dead_lettered"].includes(
    status,
  );
const defaultDraft = (): Draft => ({
  name: "",
  sourceText: "",
  goal: "",
  targetAccountIds: [],
  modelBand: "eco",
  tone: "clear, helpful",
  language: "en",
});
const fromPipeline = (p: PipelineEntry): Draft => ({
  name: p.name,
  sourceText: p.definition.sourceText ?? p.definition.brief,
  goal: p.definition.goal ?? "",
  targetAccountIds: p.definition.targetAccountIds,
  modelBand: p.definition.modelBand ?? "eco",
  tone: p.definition.tone,
  language: p.definition.language,
});

export function PipelineWorkspace({
  token,
  apiBase,
  role,
  pipelines,
  accounts,
  templates,
  onChange,
}: {
  token: string;
  apiBase: string;
  role: string;
  pipelines: PipelineEntry[];
  accounts: Account[];
  templates: Array<{
    id: string;
    name: string;
    description: string;
    available: boolean;
  }>;
  onChange: () => Promise<void>;
}) {
  const { w, locale } = useWorkspaceLanguage();
  const [view, setView] = useState<"list" | "prepare" | "run">("list");
  const [draft, setDraft] = useState<Draft>(defaultDraft),
    [saved, setSaved] = useState<PipelineEntry | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null),
    [maximum, setMaximum] = useState(1);
  const [runId, setRunId] = useState(""),
    [run, setRun] = useState<Run | null>(null),
    [approvals, setApprovals] = useState<WorkspaceApproval[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [uncertain, setUncertain] = useState(false);
  const lock = useRef(false),
    activeRun = useRef(""),
    loadSequence = useRef(0),
    restored = useRef(false);
  const canEdit = ["owner", "admin", "editor"].includes(role),
    canApprove = ["owner", "admin", "approver"].includes(role);
  const headers = useCallback(
    () => ({
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    }),
    [token],
  );
  const request = useCallback(
    async (
      path: string,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
    ) => {
      const r = await fetch(`${apiBase}${path}`, {
        method,
        headers: headers(),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store",
      });
      const value = await r.json().catch(() => null);
      if (!r.ok || value === null)
        throw Error(value?.error ?? `HTTP ${r.status}`);
      return value;
    },
    [apiBase, headers],
  );
  const busyStart = () => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    return true;
  };
  const busyEnd = () => {
    lock.current = false;
    setBusy(false);
  };
  function remember(id?: string) {
    history.replaceState(
      null,
      "",
      id ? `#pipelines/${encodeURIComponent(id)}` : "#pipelines",
    );
  }
  function showRun(id: string) {
    activeRun.current = id;
    setRunId(id);
    setRun(null);
    setApprovals([]);
    setView("run");
    setUncertain(false);
    setQuote(null);
  }
  function open(p: PipelineEntry) {
    setSaved(p);
    setDraft(fromPipeline(p));
    setError("");
    setNotice("");
    setQuote(null);
    setUncertain(false);
    remember(p.id);
    if (p.lastRunId) showRun(p.lastRunId);
    else {
      activeRun.current = "";
      setRunId("");
      setRun(null);
      setView("prepare");
    }
  }
  useEffect(() => {
    if (restored.current) return;
    const id = location.hash.split("/")[1];
    if (!id) {
      restored.current = true;
      return;
    }
    const p = pipelines.find((p) => p.id === id);
    if (p) {
      restored.current = true;
      open(p);
    }
  }, [pipelines]); // restore the saved workflow, never start it on navigation
  const refreshRun = useCallback(async () => {
    if (!runId) return;
    const sequence = ++loadSequence.current;
    const [next, pending] = await Promise.all([
      request(`/api/runs/${encodeURIComponent(runId)}`),
      canApprove ? request("/api/approval-requests") : Promise.resolve([]),
    ]);
    if (activeRun.current !== runId || sequence !== loadSequence.current)
      return;
    if (next.id !== runId) throw Error("Unexpected run");
    setRun(next);
    setApprovals(
      Array.isArray(pending)
        ? pending.filter((a: WorkspaceApproval) => a.runId === runId)
        : [],
    );
  }, [runId, request, canApprove]);
  const finished = Boolean(run && terminal(run.status));
  useEffect(() => {
    if (!runId) return;
    let live = true,
      timer: number | undefined;
    async function poll() {
      try {
        await refreshRun();
        if (live) setError("");
      } catch {
        if (live)
          setError(
            w(
              "Could not refresh this run. Check its status before retrying.",
              "No se pudo actualizar. Consulta el estado antes de reintentar.",
              "暂时无法刷新运行，请先检查状态再重试。",
            ),
          );
      }
      if (live && !finished) timer = window.setTimeout(poll, 4000);
    }
    void poll();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [refreshRun, locale, runId, finished]);
  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setQuote(null);
    setError("");
    setNotice("");
  }
  function newDraft() {
    activeRun.current = "";
    setRunId("");
    setRun(null);
    setApprovals([]);
    setSaved(null);
    setDraft({ ...defaultDraft(), language: locale });
    setQuote(null);
    setError("");
    setNotice("");
    setUncertain(false);
    setView("prepare");
    remember();
  }
  const brief = [
    draft.sourceText.trim(),
    draft.goal.trim() ? `Goal:\n${draft.goal.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const valid =
    draft.name.trim().length >= 3 && brief.length >= 10 && brief.length <= 4000;
  async function saveAndQuote(quoteRequested: boolean) {
    if (!valid || !busyStart()) return;
    try {
      const configuration = { ...draft, brief, approvalPolicy: "required" };
      const p: PipelineEntry = await request(
        saved?.status === "draft"
          ? `/api/pipelines/${saved.id}`
          : "/api/pipelines",
        {
          name: draft.name,
          source: { type: "template", templateId: "repurpose" },
          configuration,
        },
        saved?.status === "draft" ? "PATCH" : "POST",
      );
      if (!p.id) throw Error("Missing pipeline");
      setSaved(p);
      remember(p.id);
      setQuote(null);
      if (quoteRequested) {
        const ready = await request(`/api/pipelines/${p.id}/test`, {});
        if (!ready.ready) {
          setError(
            w(
              "Check your brief and select 1–5 connected X or LinkedIn accounts with publishing permission.",
              "Revisa el contenido y elige entre 1 y 5 cuentas X o LinkedIn conectadas con permiso para publicar.",
              "请检查素材，并选择 1–5 个已连接且有发布权限的 X 或 LinkedIn 账号。",
            ),
          );
          return;
        }
        await getQuote();
      } else
        setNotice(
          w(
            "Draft saved. No AI credits used.",
            "Borrador guardado. Sin consumo de créditos de IA.",
            "草稿已保存，未消耗 AI credits。",
          ),
        );
      void onChange();
    } catch {
      setError(
        w(
          "Could not save or prepare the budget. Your input is preserved; retry.",
          "No se pudo guardar o preparar el presupuesto. Conservamos tu texto; reintenta.",
          "保存或准备预算失败，输入已保留，请重试。",
        ),
      );
    } finally {
      busyEnd();
    }
  }
  async function getQuote(maxCredits?: number) {
    const q: Quote = await request("/api/billing/ai-quote", {
      kind: "prepare_ai_run",
      modelBand: draft.modelBand,
      ...(maxCredits ? { maxCredits } : {}),
    });
    if (
      !Number.isFinite(q.estimatedCredits) ||
      !Number.isFinite(q.maxCredits) ||
      q.maxCredits < 1 ||
      (!q.quoteId && q.mode !== "legacy")
    )
      throw Error("Invalid quote");
    setQuote(q);
    setMaximum(q.maxCredits);
    return q;
  }
  async function start() {
    if (!saved || !quote || !busyStart()) return;
    try {
      if (
        maximum !== quote.maxCredits ||
        (quote.expiresAt && Date.parse(quote.expiresAt) <= Date.now())
      ) {
        await getQuote(maximum);
        setNotice(
          w(
            "Budget refreshed. Review the updated amount and confirm again.",
            "Presupuesto actualizado. Revisa el importe y vuelve a confirmar.",
            "预算已更新，请核对新额度后再次确认。",
          ),
        );
        return;
      }
      // Only this explicit click can activate a saved pipeline. Never use the budget-fetch wrapper twice.
      setUncertain(true);
      const result = await request(`/api/pipelines/${saved.id}/activate`, {
        modelBand: draft.modelBand,
        ...(quote.quoteId ? { aiQuoteId: quote.quoteId } : {}),
      });
      if (!result.run?.id) throw Error("Missing run");
      showRun(result.run.id);
      setRun(result.run);
      void onChange();
    } catch {
      setError(
        w(
          "The start result is not confirmed. Check the saved run before trying again.",
          "No se confirmó el inicio. Comprueba la ejecución guardada antes de reintentar.",
          "尚未确认启动结果。请先检查已保存的运行，再尝试继续。",
        ),
      );
    } finally {
      busyEnd();
    }
  }
  async function recover() {
    if (!saved || !busyStart()) return;
    try {
      const rows: PipelineEntry[] = await request("/api/pipelines");
      const p = rows.find((p) => p.id === saved.id);
      if (p?.lastRunId) {
        setSaved(p);
        showRun(p.lastRunId);
      } else if (p) {
        setUncertain(false);
        setQuote(null);
        setSaved(p);
        await getQuote();
        setNotice(
          w(
            "No run was found. Confirm the budget to retry this saved version safely.",
            "No hay ejecución. Confirma el presupuesto para reintentar esta versión.",
            "未找到运行。请确认预算后安全重试此已保存版本。",
          ),
        );
      } else throw Error("Missing saved pipeline");
    } catch {
      setError(
        w(
          "Status could not be checked. Keep this draft and retry the status check.",
          "No se pudo comprobar el estado. Conserva el borrador y vuelve a comprobarlo.",
          "暂时无法检查状态，请保留草稿并重试状态检查。",
        ),
      );
    } finally {
      busyEnd();
    }
  }
  async function decide(
    id: string,
    decision: "approved" | "rejected",
    reason?: string,
  ) {
    try {
      await request(`/api/approval-requests/${id}/${decision}`, { reason });
      await refreshRun();
      void onChange();
      return true;
    } catch {
      return false;
    }
  }
  function revise() {
    const next = {
      ...draft,
      name:
        draft.name.slice(0, 85) + w(" · revision", " · revisión", " · 修改"),
    };
    newDraft();
    setDraft(next);
  }
  const selected = accounts.filter((a) =>
    draft.targetAccountIds.includes(a.id),
  );
  const stage = view === "prepare" ? 0 : run && terminal(run.status) ? 2 : 1;
  return (
    <div className="pipeline-workspace">
      {view === "list" ? (
        <>
          <div className="pipeline-heading">
            <div>
              <h2>
                {w(
                  "Turn an idea into a good post",
                  "Convierte una idea en una buena publicación",
                  "把想法变成一条好内容",
                )}
              </h2>
              <p>
                {w(
                  "Prepare, review and publish on one page.",
                  "Prepara, revisa y publica en una sola página.",
                  "准备、核对、发布，在同一页完成。",
                )}
              </p>
            </div>
            <button
              className="workspace-primary"
              disabled={!canEdit}
              onClick={newDraft}
            >
              {w("New pipeline", "Nuevo flujo", "新建 Pipeline")}
            </button>
          </div>
          <section className="workspace-card">
            <h2>{w("My pipelines", "Mis flujos", "我的 Pipeline")}</h2>
            {pipelines.length === 0 ? (
              <p>
                {w(
                  "Start with a brief and choose where to publish.",
                  "Empieza con tu contenido y elige dónde publicar.",
                  "从素材和目标开始，选择发布账号。",
                )}
              </p>
            ) : (
              pipelines.map((p) => (
                <div className="workspace-row" key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {t(p.lastRunStatus ?? p.status)} · v{p.version}
                    </small>
                  </div>
                  <button onClick={() => open(p)}>
                    {p.lastRunId
                      ? w("Open run", "Abrir ejecución", "打开运行")
                      : w(
                          "Continue setup",
                          "Continuar configuración",
                          "继续设置",
                        )}
                  </button>
                </div>
              ))
            )}
          </section>
          {canEdit && (
            <section className="pipeline-templates">
              {templates
                .filter((t) => t.available)
                .map((template) => (
                  <button
                    key={template.id}
                    onClick={() => {
                      newDraft();
                      setDraft((d) => ({ ...d, name: t(template.name) }));
                    }}
                  >
                    <strong>{t(template.name)}</strong>
                    <span>{t(template.description)}</span>
                  </button>
                ))}
            </section>
          )}
        </>
      ) : (
        <>
          <div className="pipeline-heading">
            <div>
              <h2>
                {draft.name ||
                  w("New pipeline", "Nuevo flujo", "新建 Pipeline")}
              </h2>
              <p>
                {w(
                  "Prepare, review and publish on one page.",
                  "Prepara, revisa y publica en una sola página.",
                  "准备、核对、发布，在同一页完成。",
                )}
              </p>
            </div>
            <button
              disabled={busy}
              onClick={() => {
                activeRun.current = "";
                setRunId("");
                setView("list");
                remember();
                void onChange();
              }}
            >
              {w("All pipelines", "Todos los flujos", "全部 Pipeline")}
            </button>
          </div>
          <ol className="pipeline-steps">
            {[
              w("Prepare content", "Preparar contenido", "准备内容"),
              w("Review & approve", "Revisar y aprobar", "核对并批准"),
              w("View results", "Ver resultados", "查看结果"),
            ].map((label, i) => (
              <li key={i} aria-current={stage === i ? "step" : undefined}>
                <span>{i < stage ? "✓" : i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          {error && (
            <p className="workspace-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="pipeline-notice" role="status">
              {notice}
            </p>
          )}
          <div className="pipeline-layout">
            <div>
              {view === "prepare" && (
                <section className="workspace-card">
                  <fieldset
                    disabled={busy || uncertain || !canEdit}
                    className="pipeline-fields"
                  >
                    <label>
                      {w("Pipeline name", "Nombre del flujo", "Pipeline 名称")}
                      <input
                        maxLength={100}
                        value={draft.name}
                        onChange={(e) => change("name", e.target.value)}
                      />
                    </label>
                    <label>
                      {w("Source material", "Material de origen", "素材内容")}
                      <textarea
                        aria-label={w(
                          "Source material",
                          "Material de origen",
                          "素材内容",
                        )}
                        rows={4}
                        maxLength={3500}
                        value={draft.sourceText}
                        onChange={(e) => change("sourceText", e.target.value)}
                        placeholder={w(
                          "Paste the product update or facts to use.",
                          "Pega la novedad o los datos que quieres usar.",
                          "粘贴产品更新或需要使用的事实素材。",
                        )}
                      />
                    </label>
                    <label>
                      {w(
                        "What should this post achieve?",
                        "¿Qué debe lograr la publicación?",
                        "希望这条内容达成什么目标？",
                      )}
                      <textarea
                        aria-label={w(
                          "What should this post achieve?",
                          "¿Qué debe lograr la publicación?",
                          "希望这条内容达成什么目标？",
                        )}
                        rows={3}
                        maxLength={2000}
                        value={draft.goal}
                        onChange={(e) => change("goal", e.target.value)}
                      />
                    </label>
                    <div className="pipeline-model">
                      <label>
                        {w(
                          "Model capability",
                          "Capacidad del modelo",
                          "模型能力",
                        )}
                        <select
                          value={draft.modelBand}
                          onChange={(e) =>
                            change("modelBand", e.target.value as Band)
                          }
                        >
                          <option value="eco">Eco</option>
                          <option value="standard">Standard</option>
                          <option value="flagship">Flagship</option>
                        </select>
                      </label>
                    </div>
                    <details>
                      <summary>
                        {w(
                          "Tone & content language",
                          "Tono e idioma del contenido",
                          "语气与内容语言",
                        )}
                      </summary>
                      <label>
                        {w("Tone", "Tono", "语气")}
                        <input
                          value={draft.tone}
                          minLength={2}
                          maxLength={200}
                          onChange={(e) => change("tone", e.target.value)}
                        />
                      </label>
                      <label>
                        {w(
                          "Content language",
                          "Idioma del contenido",
                          "内容语言",
                        )}
                        <select
                          value={draft.language}
                          onChange={(e) => change("language", e.target.value)}
                        >
                          <option value="en">English</option>
                          <option value="zh">中文</option>
                          <option value="es">Español</option>
                        </select>
                      </label>
                    </details>
                  </fieldset>
                  {brief.length > 4000 && (
                    <p role="alert">
                      {w(
                        "Keep source material and goal within 4,000 characters combined.",
                        "Limita el material y el objetivo a 4.000 caracteres en total.",
                        "素材和目标合计请保持在 4,000 字符以内。",
                      )}
                    </p>
                  )}
                  {uncertain ? (
                    <div className="pipeline-budget">
                      <p>
                        {w(
                          "Your saved version is preserved. Checking status will not generate content or charge credits.",
                          "Conservamos esta versión. Comprobar el estado no genera contenido ni consume créditos.",
                          "已保存当前版本。检查状态不会生成内容或扣费。",
                        )}
                      </p>
                      <button
                        className="workspace-primary"
                        disabled={busy}
                        onClick={() => void recover()}
                      >
                        {w(
                          "Check status and continue",
                          "Comprobar estado y continuar",
                          "检查状态并继续",
                        )}
                      </button>
                    </div>
                  ) : quote ? (
                    <div
                      className="pipeline-budget"
                      role="region"
                      aria-label={w(
                        "AI budget",
                        "Presupuesto de IA",
                        "AI 预算",
                      )}
                    >
                      <div className="pipeline-estimate">
                        <span>
                          {w("Estimated total", "Total estimado", "预计总用量")}
                        </span>
                        <strong>
                          ≈ {quote.estimatedCredits} <small>credits</small>
                        </strong>
                      </div>
                      <p>
                        {w(
                          `Reserve up to ${quote.maxCredits} credits; unused credits are released.`,
                          `Reservamos hasta ${quote.maxCredits} créditos; liberamos los no utilizados.`,
                          `最多预留 ${quote.maxCredits} credits，未使用部分退回。`,
                        )}
                      </p>
                      {quote.subscriptionPaymentRequired && (
                        <p role="alert">
                          {w(
                            "Continuing starts billing your selected subscription. Execution resumes only after payment succeeds.",
                            "Continuar inicia el cobro de tu suscripción elegida. La ejecución continúa tras confirmar el pago.",
                            "继续将启动已选订阅套餐扣费，付款成功后才执行任务。",
                          )}
                        </p>
                      )}
                      <details>
                        <summary>
                          {w(
                            "Adjust maximum credits",
                            "Ajustar el máximo de créditos",
                            "调整预算上限",
                          )}
                        </summary>
                        <label>
                          {w(
                            "Maximum credits",
                            "Créditos máximos",
                            "最高 credits",
                          )}
                          <input
                            type="number"
                            min={1}
                            max={1000000}
                            value={maximum}
                            onChange={(e) => setMaximum(Number(e.target.value))}
                            disabled={busy}
                          />
                        </label>
                      </details>
                      <div className="workspace-button-row">
                        <button disabled={busy} onClick={() => setQuote(null)}>
                          {w("Cancel", "Cancelar", "取消")}
                        </button>
                        <button
                          disabled={
                            busy ||
                            !Number.isInteger(maximum) ||
                            maximum < 1 ||
                            maximum > 1000000
                          }
                          className="workspace-primary"
                          onClick={() => void start()}
                        >
                          {busy
                            ? w("Starting…", "Iniciando…", "启动中…")
                            : w(
                                "Confirm credits & generate",
                                "Confirmar créditos y generar",
                                "确认额度并生成",
                              )}
                        </button>
                      </div>
                      <p>
                        {w(
                          "Nothing is published before your approval. The selected model will not change automatically.",
                          "No publicamos nada sin tu aprobación. No cambiamos el modelo automáticamente.",
                          "未经批准不会发布，所选模型不会自动更换。",
                        )}
                      </p>
                    </div>
                  ) : (
                    <div className="workspace-button-row">
                      <button
                        disabled={!valid || busy || !canEdit}
                        onClick={() => void saveAndQuote(false)}
                      >
                        {w("Save draft", "Guardar borrador", "保存草稿")}
                      </button>
                      <button
                        className="workspace-primary"
                        disabled={!valid || busy || !canEdit}
                        onClick={() => void saveAndQuote(true)}
                      >
                        {busy
                          ? w("Preparing…", "Preparando…", "准备中…")
                          : w(
                              "Review estimated credits",
                              "Revisar créditos estimados",
                              "查看预计 credits",
                            )}
                      </button>
                    </div>
                  )}
                </section>
              )}
              {view === "run" && (
                <>
                  {!run ? (
                    <section className="workspace-card" role="status">
                      {w(
                        "Loading saved run…",
                        "Cargando ejecución…",
                        "正在读取已保存的运行…",
                      )}
                    </section>
                  ) : (
                    <>
                      <section
                        className="workspace-card pipeline-run-status"
                        role="status"
                      >
                        <h2>
                          {run.status === "succeeded"
                            ? w(
                                "Published successfully",
                                "Publicado correctamente",
                                "已成功发布",
                              )
                            : run.status === "waiting_approval"
                              ? w(
                                  "Ready for your review",
                                  "Listo para tu revisión",
                                  "等待你核对",
                                )
                              : run.status === "cancelled"
                                ? w(
                                    "Not published · result retained",
                                    "No publicado · resultado conservado",
                                    "未发布 · 已保留结果",
                                  )
                                : terminal(run.status)
                                  ? w(
                                      "Run needs attention",
                                      "La ejecución necesita atención",
                                      "运行需要处理",
                                    )
                                  : w(
                                      "Working on this pipeline…",
                                      "Procesando este flujo…",
                                      "正在执行此 Pipeline…",
                                    )}
                        </h2>
                        <p>{t(run.status)}</p>
                        <small>
                          {w("Run", "Ejecución", "运行")} · {run.id}
                        </small>
                        <button
                          onClick={() =>
                            void refreshRun().catch(() =>
                              setError(
                                w(
                                  "Could not refresh. Retry.",
                                  "No se pudo actualizar. Reintenta.",
                                  "刷新失败，请重试。",
                                ),
                              ),
                            )
                          }
                        >
                          {w("Refresh status", "Actualizar estado", "刷新状态")}
                        </button>
                      </section>
                      {run.status === "waiting_approval" && !canApprove && (
                        <p>
                          {w(
                            "An owner, admin or approver must approve this draft.",
                            "Un propietario, administrador o aprobador debe aprobar este borrador.",
                            "需要负责人、管理员或审核者批准此草稿。",
                          )}
                        </p>
                      )}
                      {approvals.map((a) => (
                        <PipelineReview
                          key={a.id}
                          approval={a}
                          accounts={accounts}
                          onDecision={decide}
                          onRevision={canEdit ? revise : undefined}
                        />
                      ))}
                      {run.status === "waiting_approval" &&
                        canApprove &&
                        !approvals.length && (
                          <p>
                            {w(
                              "Refreshing the approval request. No action is needed yet.",
                              "Actualizando la solicitud de aprobación. Espera un momento.",
                              "正在刷新审核请求，请稍候。",
                            )}
                          </p>
                        )}
                      <ExecutionHistory
                        key={`${run.id}:${run.status}`}
                        token={token}
                        apiBase={apiBase}
                        kind="workflow"
                        id={run.id}
                        requested={run.modelBand}
                      />
                      <RunDiagnostics run={run} />
                      {terminal(run.status) && canEdit && (
                        <button onClick={revise}>
                          {w(
                            "Prepare a new version",
                            "Preparar una nueva versión",
                            "准备新版本",
                          )}
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
            <aside className="pipeline-summary">
              <section className="workspace-card">
                <h3>{w("Publish to", "Publicar en", "发布到")}</h3>
                <p>
                  {w(
                    "Text posts · X and LinkedIn",
                    "Publicaciones de texto · X y LinkedIn",
                    "纯文字发布 · X 和 LinkedIn",
                  )}
                </p>
                {view === "prepare" ? (
                  <fieldset disabled={busy || uncertain || !canEdit}>
                    {accounts.map((a) => {
                      const available =
                        a.status === "connected" &&
                        supportsAnnouncement(a.platform) &&
                        a.capabilities.includes("publish");
                      return (
                        <label className="pipeline-account" key={a.id}>
                          <input
                            type="checkbox"
                            checked={draft.targetAccountIds.includes(a.id)}
                            disabled={
                              !available &&
                              !draft.targetAccountIds.includes(a.id)
                            }
                            onChange={() =>
                              change(
                                "targetAccountIds",
                                draft.targetAccountIds.includes(a.id)
                                  ? draft.targetAccountIds.filter(
                                      (id) => id !== a.id,
                                    )
                                  : [...draft.targetAccountIds, a.id],
                              )
                            }
                          />
                          <span>
                            <strong>{a.displayName}</strong>
                            <small>
                              {a.platform} · {t(a.status)}
                              {!available
                                ? ` · ${w("Unavailable", "No disponible", "不可用")}`
                                : ""}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                    {!accounts.length && (
                      <a href="#accounts">
                        {w(
                          "Connect an account",
                          "Conectar una cuenta",
                          "连接账号",
                        )}
                      </a>
                    )}
                  </fieldset>
                ) : (
                  <>
                    {selected.map((a) => (
                      <p key={a.id}>
                        <strong>{a.displayName}</strong>
                        <br />
                        {a.platform}
                      </p>
                    ))}
                    <p>
                      {w("Selected model", "Modelo seleccionado", "所选模型")}:{" "}
                      {draft.modelBand}
                    </p>
                  </>
                )}
              </section>
              <div className="pipeline-guard">
                <strong>
                  {w(
                    "Review first, then publish",
                    "Revisa antes de publicar",
                    "先审核，再发布",
                  )}
                </strong>
                <p>
                  {w(
                    "Approve the exact copy and destination here. Reviewing does not generate new content or consume more AI credits.",
                    "Aprueba aquí el texto exacto y el destino. Revisar no genera contenido ni consume más créditos de IA.",
                    "在这里核对确切文案和目标账号。审核不会生成新内容或再次消耗 AI credits。",
                  )}
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function PipelineReview({
  approval,
  accounts,
  onDecision,
  onRevision,
}: {
  approval: WorkspaceApproval;
  accounts: Account[];
  onDecision: (
    id: string,
    decision: "approved" | "rejected",
    reason?: string,
  ) => Promise<boolean>;
  onRevision?: () => void;
}) {
  const { w } = useWorkspaceLanguage();
  const [checked, setChecked] = useState(false),
    [decision, setDecision] = useState<
      "approved" | "rejected" | "revise" | null
    >(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const [snapshot, setSnapshot] = useState<WorkspaceApproval | null>(null);
  const actions = Array.isArray(approval.requestedAction.actions)
    ? (approval.requestedAction.actions as Array<Record<string, unknown>>)
    : [];
  const stale =
    snapshot !== null && JSON.stringify(snapshot) !== JSON.stringify(approval);
  async function confirm() {
    if (!decision || !snapshot || stale || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const revise = decision === "revise";
    try {
      if (
        await onDecision(
          snapshot.id,
          decision === "approved" ? "approved" : "rejected",
          reason.trim() || undefined,
        )
      ) {
        if (revise) onRevision?.();
        setDecision(null);
      } else
        setError(
          w(
            "Decision not confirmed. Your note is preserved; retry.",
            "Decisión no confirmada. Conservamos tu nota; reintenta.",
            "决定尚未确认，备注已保留，请重试。",
          ),
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function choose(value: "approved" | "rejected" | "revise") {
    setSnapshot(structuredClone(approval));
    setDecision(value);
    setError("");
  }
  return (
    <article className="workspace-card pipeline-review">
      <h2>
        {approval.requestedAction.summary ||
          w("Review this draft", "Revisar el borrador", "核对这份草稿")}
      </h2>
      {actions.length ? (
        actions.map((action, i) => {
          const account = accounts.find(
            (a) =>
              a.externalAccountId === action.accountId ||
              a.id === action.accountId,
          );
          return (
            <section className="pipeline-post" key={i}>
              <strong>
                {account?.displayName ?? String(action.accountId ?? "—")}
              </strong>
              <small>
                {String(action.platform ?? "")}
              </small>
              <pre translate="no">
                {[
                  action.content,
                  ...(Array.isArray(action.hashtags) ? action.hashtags : []),
                ]
                  .filter(Boolean)
                  .map(String)
                  .join(" ")}
              </pre>
            </section>
          );
        })
      ) : (
        <pre className="approval-snapshot" translate="no">
          {JSON.stringify(approval.requestedAction, null, 2)}
        </pre>
      )}
      {decision ? (
        <section className="pipeline-confirm">
          <h3>
            {decision === "approved"
              ? w("Confirm publication", "Confirmar publicación", "确认发布")
              : decision === "revise"
                ? w(
                    "Reject this version and prepare a revision?",
                    "¿Rechazar esta versión y preparar otra?",
                    "拒绝当前版本并准备修改？",
                  )
                : w(
                    "Do not publish this version?",
                    "¿No publicar esta versión?",
                    "暂不发布当前版本？",
                  )}
          </h3>
          <p>
            {decision === "approved"
              ? w(
                  "This approves the exact content and accounts shown above.",
                  "Apruebas el texto exacto y las cuentas mostradas arriba.",
                  "将批准上方展示的确切内容和账号。",
                )
              : w(
                  "This version will not be published. Its generated content remains saved. A new generation requires another credit confirmation.",
                  "Esta versión no se publicará. Conservamos el contenido. Una nueva generación requiere confirmar créditos de nuevo.",
                  "当前版本不会发布，已生成内容继续保留。再次生成需要重新确认额度。",
                )}
          </p>
          <label>
            {w(
              "Decision note (optional)",
              "Nota de decisión (opcional)",
              "决定备注（可选）",
            )}
            <textarea
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
          </label>
          {stale && (
            <p role="alert">
              {w(
                "The request changed. Cancel and review it again.",
                "La solicitud cambió. Cancela y revísala de nuevo.",
                "请求已变化，请取消并重新核对。",
              )}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="workspace-button-row">
            <button disabled={busy} onClick={() => setDecision(null)}>
              {w("Cancel", "Cancelar", "取消")}
            </button>
            <button
              className="workspace-primary"
              disabled={busy || stale}
              onClick={() => void confirm()}
            >
              {busy
                ? w("Saving…", "Guardando…", "保存中…")
                : w("Confirm decision", "Confirmar decisión", "确认决定")}
            </button>
          </div>
        </section>
      ) : (
        <>
          <label className="pipeline-check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            {w(
              "I checked the copy and destination accounts",
              "He revisado el texto y las cuentas de destino",
              "我已核对文案与目标账号",
            )}
          </label>
          <div className="workspace-button-row">
            <button onClick={() => choose("rejected")}>
              {w("Do not publish yet", "No publicar todavía", "暂不发布")}
            </button>
            {onRevision && (
              <button onClick={() => choose("revise")}>
                {w("Request changes", "Solicitar cambios", "请求修改")}
              </button>
            )}
            <button
              className="workspace-primary"
              disabled={!checked}
              onClick={() => choose("approved")}
            >
              {w("Approve & publish", "Aprobar y publicar", "批准并发布")}
            </button>
          </div>
        </>
      )}
    </article>
  );
}
