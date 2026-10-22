import { useEffect, useRef, useState } from "react";
import { AudienceWorkspace } from "../audience/AudienceWorkspace";
import { useWorkspaceLanguage } from "./useWorkspaceLanguage";
import { WorkspaceDialog } from "./Shell";
import { previewImport } from "./import-preview";
import { downloadReport } from "./report-export";

type Band = "eco" | "standard" | "flagship";
type Persona = "creators" | "sellers" | "community-hosts";
type Preference = {
  persona: Persona;
  modelBand: Band;
  language: "en" | "es" | "zh";
  goal: string;
};
type Task = {
  id: string;
  goal: string;
  status: string;
  sourceKind: string;
  persona?: Persona;
  language?: "en" | "zh" | "es";
  sourceId: string | null;
  version: number;
  modelBand: Band;
  batchIds: string[];
  archivedAt: string | null;
  parentTaskId?: string | null;
  waitingReason?: string | null;
  review?: { messageId: string; refs: string[] } | null;
};
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  error: string | null;
  citations: Array<{ ref: string; snippet: string }>;
};
type Detail = { task: Task; messages: Message[] };
type Props = {
  token: string;
  apiBase: string;
  workspaceId: string;
  role: string;
  canRun: boolean;
  onFullReport: (id: string) => void;
  onUsageChange: () => void;
};
export function useTaskApi(token: string, apiBase: string) {
  return async function api<T>(
    path: string,
    body?: object,
    method = body ? "POST" : "GET",
  ): Promise<T> {
    const response = await fetch(apiBase + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const result = await response
      .json()
      .catch(() => ({ error: "request_failed" }));
    if (!response.ok) throw new Error(result.error ?? "request_failed");
    return result as T;
  };
}
function taskHash() {
  return location.hash.startsWith("#start/task/")
    ? (location.hash.split("/")[2] ?? "")
    : "";
}
export function TaskWorkspace(props: Props) {
  const { w, locale } = useWorkspaceLanguage(),
    api = useTaskApi(props.token, props.apiBase);
  const [legacy, setLegacy] = useState(
    () =>
      new URLSearchParams(location.search).get("mode") === "template" ||
      /^#start\/(creators|sellers|community-hosts)/.test(location.hash),
  );
  const [taskId, setTaskId] = useState(taskHash),
    [history, setHistory] = useState(false),
    [archived, setArchived] = useState(false),
    [tasks, setTasks] = useState<Task[]>([]),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [readingFile, setReadingFile] = useState(false),
    [stage, setStage] = useState(1),
    [source, setSource] = useState<"paste" | "csv" | "existing">("paste"),
    [content, setContent] = useState(""),
    [label, setLabel] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [batches, setBatches] = useState<
      Array<{ id: string; label: string; status: string }>
    >([]),
    [goal, setGoal] = useState(""),
    [persona, setPersona] = useState<Persona>("creators"),
    [band, setBand] = useState<Band>("standard"),
    [outputLanguage, setOutputLanguage] = useState<"en" | "zh" | "es">(locale);
  const nonce = useRef(crypto.randomUUID()),
    submitting = useRef(false),
    draftTask = useRef(""),
    defaults = useRef<Preference | null>(null),
    draftTouched = useRef(false),
    fileRead = useRef(0),
    alive = useRef(true),
    navigation = useRef(0);
  useEffect(() => {
    let live = true;
    alive.current = true;
    void api<Preference>("/api/task-preferences")
      .then((p) => {
        if (live && typeof p.goal === "string") {
          defaults.current = p;
          if (draftTouched.current) return;
          setGoal(p.goal);
          const audience = new URLSearchParams(location.search).get("persona");
          setPersona(
            audience === "creators" ||
              audience === "sellers" ||
              audience === "community-hosts"
              ? audience
              : p.persona,
          );
          setBand(p.modelBand);
          setOutputLanguage(p.language);
        }
      })
      .catch(() => {});
    void api<typeof batches>("/api/imports")
      .then((value) => {
        if (live && Array.isArray(value)) setBatches(value);
      })
      .catch(() => {});
    const restore = () => {
      setTaskId(taskHash());
      setHistory(false);
    };
    window.addEventListener("popstate", restore);
    return () => {
      live = false;
      alive.current = false;
      window.removeEventListener("popstate", restore);
    };
  }, [props.token, props.workspaceId]);
  function openTask(id: string) {
    if (!alive.current) return;
    navigation.current++;
    setTaskId(id);
    setHistory(false);
    setError("");
    window.history.pushState(null, "", `#start/task/${id}`);
  }
  async function loadHistory(includeArchived = archived, nextOffset = 0) {
    setBusy(true);
    setError("");
    const request = ++navigation.current;
    try {
      const rows = await api<Task[]>(
        `/api/tasks?archived=${includeArchived ? "1" : "0"}&offset=${nextOffset}`,
      );
      if (!alive.current || request !== navigation.current) return;
      setTasks(rows);
      setOffset(nextOffset);
      setHistory(true);
      setTaskId("");
    } catch (e) {
      setError(taskError((e as Error).message, w));
    } finally {
      setBusy(false);
    }
  }
  function fresh() {
    navigation.current++;
    draftTouched.current = false;
    fileRead.current++;
    setReadingFile(false);
    if (defaults.current) {
      setGoal(defaults.current.goal);
      setBand(defaults.current.modelBand);
      setPersona(defaults.current.persona);
      setOutputLanguage(defaults.current.language);
    }
    setTaskId("");
    setHistory(false);
    setLegacy(false);
    setStage(1);
    setContent("");
    setSelected([]);
    setError("");
    draftTask.current = "";
    nonce.current = crypto.randomUUID();
    const url = new URL(location.href);
    url.searchParams.delete("mode");
    url.hash = "start";
    window.history.pushState(null, "", url);
  }
  async function run() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    let id = "";
    try {
      const task = await api<Task>("/api/tasks", {
        requestId: nonce.current,
        goal,
        persona,
        modelBand: band,
        language: outputLanguage,
        batchIds: source === "existing" ? selected : [],
      });
      id = task.id;
      draftTask.current = id;
      if (alive.current)
        window.history.replaceState(null, "", `#start/task/${id}`);
      if (source !== "existing")
        await api("/api/imports", {
          taskId: id,
          label: label.trim(),
          sourceType: source,
          content,
          modelBand: band,
          deduplicate: true,
        });
      const detail = await api<Detail>(`/api/tasks/${id}`);
      await api(`/api/tasks/${id}/messages`, {
        requestId: nonce.current,
        expectedVersion: detail.task.version,
        message: goal,
        modelBand: band,
      });
      openTask(id);
      props.onUsageChange();
    } catch (e) {
      if (id) openTask(id);
      setError(taskError((e as Error).message, w));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const controls = (
    <div className="workspace-button-row task-view-controls">
      <button disabled={busy} onClick={fresh}>
        {w("New task", "Nueva tarea", "新建任务")}
      </button>
      <button disabled={busy} onClick={() => void loadHistory()}>
        {w("Task history", "Historial", "任务记录")}
      </button>
      <button
        disabled={busy}
        onClick={() => {
          setLegacy((v) => !v);
          setTaskId("");
          setHistory(false);
          const url = new URL(location.href);
          if (!legacy) url.searchParams.set("mode", "template");
          else url.searchParams.delete("mode");
          url.hash = "start";
          window.history.replaceState(null, "", url);
        }}
      >
        {legacy
          ? w("Flexible goal", "Objetivo libre", "自由目标")
          : w("Structured templates", "Plantillas", "结构化模板")}
      </button>
    </div>
  );
  if (legacy && !taskId && !history)
    return (
      <>
        {controls}
        <AudienceWorkspace {...props} />
      </>
    );
  return (
    <>
      {controls}
      {error && (
        <p role="alert" className="workspace-error">
          {error}
        </p>
      )}
      {history ? (
        <section className="workspace-card">
          <h2>{w("Task history", "Historial de tareas", "任务记录")}</h2>
          <label>
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => {
                setArchived(e.target.checked);
                void loadHistory(e.target.checked);
              }}
            />
            {w(
              "Show removed tasks",
              "Mostrar tareas retiradas",
              "显示已移除任务",
            )}
          </label>
          {!tasks.length && (
            <p>
              {w(
                "No tasks in this view.",
                "No hay tareas en esta vista.",
                "此列表暂无任务。",
              )}
            </p>
          )}
          {tasks.map((task) => (
            <article className="workspace-row" key={task.id}>
              <div>
                <strong>{task.goal}</strong>
                <small>
                  {taskStatus(task.status, w)} ·{" "}
                  {
                    (
                      {
                        conversation: w(
                          "Goal task",
                          "Tarea con objetivo",
                          "目标任务",
                        ),
                        report: w("Report", "Informe", "报告"),
                        import: w("Source import", "Importación", "素材导入"),
                        workflow: w("Publishing", "Publicación", "发布任务"),
                      } as Record<string, string>
                    )[task.sourceKind]
                  }
                </small>
              </div>
              <button onClick={() => openTask(task.id)}>
                {w("Open task", "Abrir tarea", "打开任务")}
              </button>
            </article>
          ))}
          <div className="workspace-button-row">
            <button
              disabled={busy || offset === 0}
              onClick={() => void loadHistory(archived, offset - 50)}
            >
              {w("Previous", "Anterior", "上一页")}
            </button>
            <span>{offset / 50 + 1}</span>
            <button
              disabled={busy || tasks.length < 50}
              onClick={() => void loadHistory(archived, offset + 50)}
            >
              {w("Next", "Siguiente", "下一页")}
            </button>
            <button
              disabled={busy}
              onClick={() => void loadHistory(archived, offset)}
            >
              {w("Refresh", "Actualizar", "刷新")}
            </button>
          </div>
        </section>
      ) : taskId ? (
        <TaskConversation
          key={taskId}
          {...props}
          taskId={taskId}
          onOpenTask={openTask}
        />
      ) : (
        <div className="task-new">
          <h2>
            {w(
              "One task, one conversation.",
              "Una tarea, una conversación.",
              "一个任务，一段连续对话。",
            )}
          </h2>
          <p>
            {w(
              "Import your data, tell Piggybot the goal, and keep working with the result here.",
              "Importa tus datos, explica el objetivo y continúa con el resultado aquí.",
              "导入素材、说明目标，在这里继续核对和使用结果。",
            )}
          </p>
          <ol className="task-steps">
            {[
              w("Import data", "Importar datos", "导入数据"),
              w("Confirm goal", "Confirmar objetivo", "确认目标"),
              w("Results", "Resultados", "输出结果"),
            ].map((text, index) => (
              <li
                key={text}
                aria-current={stage === index + 1 ? "step" : undefined}
              >
                {index + 1} · {text}
              </li>
            ))}
          </ol>
          {stage === 1 ? (
            <section className="workspace-card">
              <h3>{w("Your source", "Tus fuentes", "数据来源")}</h3>
              <label>
                {w("Source type", "Tipo de fuente", "来源类型")}
                <select
                  aria-label={w("Source type", "Tipo de fuente", "来源类型")}
                  value={source}
                  onChange={(e) => {
                    fileRead.current++;
                    setReadingFile(false);
                    setSource(e.target.value as typeof source);
                  }}
                >
                  <option value="paste">
                    {w("Paste text", "Pegar texto", "粘贴文本")}
                  </option>
                  <option value="csv">CSV</option>
                  <option value="existing">
                    {w(
                      "Reuse imported data",
                      "Reutilizar datos",
                      "复用已导入数据",
                    )}
                  </option>
                </select>
              </label>
              {source === "existing" ? (
                <div>
                  {batches
                    .filter((b) => b.status === "classified")
                    .map((batch) => (
                      <label className="task-source-choice" key={batch.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(batch.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, batch.id]
                                : selected.filter((id) => id !== batch.id),
                            )
                          }
                        />
                        {batch.label}
                      </label>
                    ))}
                  {!batches.some((b) => b.status === "classified") && (
                    <p>
                      {w(
                        "No classified sources yet. Paste text or upload CSV.",
                        "Aún no hay fuentes clasificadas. Pega texto o sube CSV.",
                        "还没有可复用的素材，请粘贴文本或上传 CSV。",
                      )}
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <label>
                    {w("Source name", "Nombre de fuente", "来源名称")}
                    <input
                      value={label}
                      maxLength={120}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </label>
                  {source === "csv" ? (
                    <label>
                      CSV
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(e) => {
                          const request = ++fileRead.current;
                          setContent("");
                          setReadingFile(false);
                          const file = e.target.files?.[0];
                          if (file) {
                            setError("");
                            if (file.size > 2 * 1024 * 1024) {
                              setError(
                                w(
                                  "Use a CSV under 2 MiB.",
                                  "Usa CSV de menos de 2 MiB.",
                                  "请使用小于 2 MiB 的 CSV。",
                                ),
                              );
                              return;
                            }
                            setReadingFile(true);
                            void file
                              .text()
                              .then((value) => {
                                if (fileRead.current === request)
                                  setContent(value);
                              })
                              .catch(() => {
                                if (fileRead.current === request)
                                  setError("file_read_failed");
                              })
                              .finally(() => {
                                if (fileRead.current === request)
                                  setReadingFile(false);
                              });
                          }
                        }}
                      />
                    </label>
                  ) : (
                    <label>
                      {w(
                        "One item per line",
                        "Un elemento por línea",
                        "每行一条内容",
                      )}
                      <textarea
                        value={content}
                        rows={8}
                        onChange={(e) => setContent(e.target.value)}
                      />
                    </label>
                  )}
                </>
              )}
              <button
                className="workspace-primary"
                disabled={readingFile}
                onClick={() => {
                  setError("");
                  try {
                    if (source === "existing") {
                      if (!selected.length || selected.length > 10)
                        throw new Error(
                          w(
                            "Select 1–10 sources.",
                            "Selecciona de 1 a 10 fuentes.",
                            "请选择 1–10 个来源。",
                          ),
                        );
                    } else {
                      if (!label.trim())
                        throw new Error(
                          w(
                            "Name this source first.",
                            "Pon un nombre a la fuente.",
                            "请先填写来源名称。",
                          ),
                        );
                      previewImport(content, source);
                    }
                    setStage(2);
                  } catch (e) {
                    setError(taskError((e as Error).message, w));
                  }
                }}
              >
                {w("Confirm the goal →", "Confirmar objetivo →", "确认目标 →")}
              </button>
            </section>
          ) : (
            <section className="workspace-card">
              <details>
                <summary>
                  {w(
                    "Review source scope",
                    "Revisar las fuentes",
                    "核对素材范围",
                  )}
                </summary>
                <pre>
                  {source === "existing"
                    ? selected
                        .map(
                          (id) => batches.find((b) => b.id === id)?.label ?? id,
                        )
                        .join("\n")
                    : previewImport(content, source).slice(0, 5).join("\n\n")}
                </pre>
              </details>
              <label>
                {w("Scenario", "Escenario", "使用场景")}
                <select
                  value={persona}
                  onChange={(e) => setPersona(e.target.value as Persona)}
                >
                  <option value="creators">
                    {w("Creators", "Creadores", "创作者")}
                  </option>
                  <option value="sellers">
                    {w("Sellers", "Vendedores", "卖家")}
                  </option>
                  <option value="community-hosts">
                    {w("Community hosts", "Comunidades", "社群主理人")}
                  </option>
                </select>
              </label>
              <label>
                {w("Task goal", "Objetivo de la tarea", "任务目标")}
                <textarea
                  rows={7}
                  maxLength={4000}
                  aria-label={w("Task goal","Objetivo de la tarea","任务目标")} value={goal}
                  onChange={(e) => {
                    draftTouched.current = true;
                    setGoal(e.target.value);
                  }}
                  placeholder={w(
                    "What should we find, create or decide?",
                    "¿Qué debemos encontrar, crear o decidir?",
                    "你希望发现、制作或决定什么？",
                  )}
                />
              </label>
              <label>
                {w("Output language", "Idioma del resultado", "结果语言")}
                <select
                  value={outputLanguage}
                  onChange={(e) =>
                    setOutputLanguage(e.target.value as typeof outputLanguage)
                  }
                >
                  <option value="en">English</option>
                  <option value="zh">中文</option>
                  <option value="es">Español</option>
                </select>
              </label>
              <div className="au-model-control">
                <BandPicker
                  value={band}
                  onChange={(value) => {
                    draftTouched.current = true;
                    setBand(value);
                  }}
                />
              </div>
              <p>
                {w(
                  "Each model step costs Eco 1 / Standard 6 / Flagship 20 credits. A turn can use up to 4 steps; a source import is charged separately. Follow-up turns are also paid.",
                  "Cada paso cuesta Eco 1 / Standard 6 / Flagship 20 créditos. Cada turno usa hasta 4 pasos; importar y los turnos siguientes se cobran aparte.",
                  "每个模型步骤消耗 Eco 1 / Standard 6 / Flagship 20 credits，每轮最多 4 步；导入分类和后续对话分别计费。",
                )}
              </p>
              <p>
                {w(
                  "External publishing always needs a separate approval.",
                  "Publicar siempre requiere aprobación por separado.",
                  "对外发布仍需单独审核。",
                )}
              </p>
              <div className="workspace-button-row">
                <button disabled={busy} onClick={() => setStage(1)}>
                  {w("Back", "Atrás", "返回")}
                </button>
                <button
                  className="workspace-primary"
                  disabled={
                    busy ||
                    !props.canRun ||
                    props.role === "viewer" ||
                    !goal.trim()
                  }
                  onClick={() => void run()}
                >
                  {busy
                    ? w("Starting…", "Iniciando…", "启动中…")
                    : w("Run this task", "Iniciar tarea", "开始任务")}
                </button>
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
function BandPicker({
  value,
  onChange,
}: {
  value: Band;
  onChange: (v: Band) => void;
}) {
  const { w } = useWorkspaceLanguage();
  return (
    <label>
      {w("Model capability", "Capacidad del modelo", "模型能力")}
      <select
        aria-label={w("Model capability", "Capacidad del modelo", "模型能力")}
        value={value}
        onChange={(e) => onChange(e.target.value as Band)}
      >
        <option value="eco">Eco · {w("Fast", "Rápido", "轻量")}</option>
        <option value="standard">
          Standard · {w("Balanced", "Equilibrado", "均衡")}
        </option>
        <option value="flagship">
          Flagship · {w("Deep reasoning", "Razonamiento", "深度")}
        </option>
      </select>
    </label>
  );
}
function TaskConversation(
  props: Props & { taskId: string; onOpenTask: (id: string) => void },
) {
  const { w } = useWorkspaceLanguage(),
    api = useTaskApi(props.token, props.apiBase);
  const [data, setData] = useState<Detail | null>(null),
    [text, setText] = useState(""),
    [band, setBand] = useState<Band>("standard"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [archiveDialog, setArchiveDialog] = useState(false),
    [evidence, setEvidence] = useState<{
      text: string;
      author: string | null;
    } | null>(null),
    [reviewed, setReviewed] = useState(false);
  const nonce = useRef<string>(""),
    sending = useRef(false);
  async function refresh() {
    const next = await api<Detail>(`/api/tasks/${props.taskId}`);
    setData(next);
    return next;
  }
  useEffect(() => {
    let stopped = false,
      initialized = false;
    setData(null);
    setError("");
    setText("");
    nonce.current = "";
    const poll = async () => {
      try {
        const next = await api<Detail>(`/api/tasks/${props.taskId}`);
        if (stopped) return;
        setData(next);
        if (!initialized) {
          setBand(next.task.modelBand);
          initialized = true;
        }
      } catch (e) {
        if (!stopped) setError(taskError((e as Error).message, w));
      }
    };
    void poll();
    const focus = () => void poll();
    window.addEventListener("focus", focus);
    return () => {
      stopped = true;
      window.removeEventListener("focus", focus);
    };
  }, [props.taskId, props.token]);
  async function send() {
    if (!data || sending.current || !text.trim()) return;
    sending.current = true;
    setBusy(true);
    setError("");
    nonce.current ||= crypto.randomUUID();
    try {
      await api(`/api/tasks/${props.taskId}/messages`, {
        message: text,
        modelBand: band,
        requestId: nonce.current,
        expectedVersion: data.task.version,
      });
      setText("");
      nonce.current = "";
      await refresh();
      props.onUsageChange();
    } catch (e) {
      setError(taskError((e as Error).message, w));
      await refresh().catch(() => {});
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!data || !["queued", "running"].includes(data.task.status)) return;
    const timer = setInterval(
      () => void refresh().catch((e) => setError(taskError(e.message, w))),
      3000,
    );
    return () => clearInterval(timer);
  }, [data?.task.status, props.taskId]);
  const latest = data?.messages
      .filter((m) => m.role === "assistant" && m.status === "completed")
      .at(-1),
    saved = !!latest && data?.task.review?.messageId === latest.id;
  if (!data)
    return (
      <p role="status">
        {error || w("Loading task…", "Cargando tarea…", "读取任务…")}
      </p>
    );
  const task = data.task,
    working = ["queued", "running"].includes(task.status),
    canEdit = props.role !== "viewer" && !task.archivedAt,
    canWrite = props.canRun && canEdit;
  function csv() {
    const cell = (v: string) =>
      '"' + v.replace(/^\s*[=+\-@]/, "'$&").replaceAll('"', '""') + '"';
    return (
      "\uFEFF" +
      [
        ["message_id", "evidence_ref", "validated_excerpt"],
        ...data!.messages.flatMap((m) =>
          m.citations.map((c) => [m.id, c.ref, c.snippet]),
        ),
      ]
        .map((row) => row.map(cell).join(","))
        .join("\r\n") +
      "\r\n"
    );
  }
  return (
    <section className="workspace-card task-conversation">
      <h2>{task.goal}</h2>
      <p>
        {w("Task", "Tarea", "任务")} {task.id} · {taskStatus(task.status, w)}
        {task.archivedAt ? " · " + w("Removed", "Retirada", "已移除") : ""}
      </p>
      <div className="workspace-button-row">
        <button
          onClick={() =>
            void refresh().catch((e) => setError(taskError(e.message, w)))
          }
        >
          {w("Refresh", "Actualizar", "刷新")}
        </button>
        <button
          onClick={() =>
            downloadReport(
              `task-${task.id}.md`,
              `# ${task.goal}\n\n${data.messages.map((m) => `## ${m.role}\n\n${m.content}`).join("\n\n")}`,
            )
          }
        >
          {w("Download .md", "Descargar .md", "下载 .md")}
        </button>
        <button
          onClick={() =>
            downloadReport(
              `task-${task.id}.csv`,
              csv(),
              "text/csv;charset=utf-8",
            )
          }
        >
          {w("Evidence .csv", "Evidencias .csv", "证据 .csv")}
        </button>
        {props.role !== "viewer" &&
          (task.status === "failed" || task.archivedAt) && (
            <button onClick={() => setArchiveDialog(true)}>
              {task.archivedAt
                ? w("Restore task", "Restaurar tarea", "恢复任务")
                : w(
                    "Remove failed task",
                    "Retirar tarea fallida",
                    "移除失败任务",
                  )}
            </button>
          )}
      </div>
      {error && (
        <p role="alert" className="workspace-error">
          {error}
        </p>
      )}
      {task.waitingReason === "ai_credits_deferred" && (
        <div role="status">
          <p>
            {w(
              "Waiting for available AI credits. After updating your plan or credits, resume this task.",
              "Esperando créditos de IA. Tras actualizar el plan o saldo, reanuda esta tarea.",
              "任务正在等待可用 AI 额度。更新套餐或额度后，可继续原任务。",
            )}
          </p>
          <a href="#billing">
            {w("Plan & usage", "Plan y consumo", "套餐与用量")}
          </a>
          <button
            disabled={!canWrite || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/api/tasks/${task.id}/resume`, {
                  reason: "Resume task after restoring available AI credits",
                });
                await refresh();
              } catch (e) {
                setError(taskError((e as Error).message, w));
              } finally {
                setBusy(false);
              }
            }}
          >
            {w("Resume task", "Reanudar tarea", "继续任务")}
          </button>
        </div>
      )}
      {task.sourceKind !== "conversation" ? (
        <>
          <p>
            {w(
              "The source record and its evidence are preserved.",
              "Conservamos el registro y sus evidencias.",
              "原记录及证据仍然保留。",
            )}
          </p>
          {task.sourceKind === "report" && canWrite && (
            <div className="task-composer">
              <label>
                {w(
                  "Follow-up goal",
                  "Objetivo de seguimiento",
                  "继续分析的目标",
                )}
                <textarea aria-label={w("Follow-up goal","Objetivo de seguimiento","继续分析的目标")}
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={4000}
                />
              </label>
              <div className="au-model-control">
                <BandPicker value={band} onChange={setBand} />
                <button
                  disabled={busy || !text.trim()}
                  onClick={async () => {
                    setBusy(true);
                    let forkId = "";
                    try {
                      const next = await api<Task>("/api/tasks", {
                        requestId: crypto.randomUUID(),
                        parentTaskId: task.id,
                        goal: text,
                        persona: task.persona ?? "creators",
                        modelBand: band,
                        language:
                          task.language ??
                          (document.documentElement.lang === "zh"
                            ? "zh"
                            : document.documentElement.lang === "es"
                              ? "es"
                              : "en"),
                      });
                      forkId = next.id;
                      await api(`/api/tasks/${next.id}/messages`, {
                        requestId: crypto.randomUUID(),
                        expectedVersion: next.version,
                        message: text,
                        modelBand: band,
                      });
                      props.onOpenTask(next.id);
                    } catch (e) {
                      setError(taskError((e as Error).message, w));
                      if (forkId) props.onOpenTask(forkId);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {w(
                    "Continue with this context",
                    "Continuar con el contexto",
                    "沿用上下文继续",
                  )}
                </button>
              </div>
              <small>
                {w(
                  "A paid conversation will reuse this report summary and original sources.",
                  "La conversación de pago reutiliza el resumen y las fuentes.",
                  "新的付费对话会沿用此报告摘要和原始素材。",
                )}
              </small>
            </div>
          )}
          {task.sourceKind === "report" && task.sourceId && (
            <button onClick={() => props.onFullReport(task.sourceId!)}>
              {w("Open report", "Abrir informe", "打开报告")}
            </button>
          )}
          <p>
            {w(
              "Open Sources or Activity for the original import / publishing run.",
              "Abre Fuentes o Actividad para ver el proceso original.",
              "可在数据来源或活动中查看原始导入和发布记录。",
            )}
          </p>
        </>
      ) : (
        <>
          {data.messages.map((message) => (
            <article className="task-message" key={message.id}>
              <h3>
                {message.role === "user" ? w("You", "Tú", "你") : "Piggybot"}
              </h3>
              <pre translate="no">
                {message.content ||
                  w(
                    "Working with your task context…",
                    "Procesando el contexto…",
                    "正在结合任务上下文处理…",
                  )}
              </pre>
              {message.error && <p role="alert">{message.error}</p>}
              {message.citations.map((citation, index) => (
                <blockquote key={index}>
                  <p translate="no">{citation.snippet}</p>
                  <button
                    onClick={() =>
                      void api<{ text: string; author: string | null }>(
                        `/api/tasks/${task.id}/evidence/${citation.ref}`,
                      )
                        .then(setEvidence)
                        .catch((e) => setError(taskError(e.message, w)))
                    }
                  >
                    {w("View source", "Ver fuente", "核对原文")}
                  </button>
                </blockquote>
              ))}
            </article>
          ))}
          {latest && (
            <div className="task-review">
              <label>
                <input
                  type="checkbox"
                  checked={reviewed || saved}
                  disabled={saved}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                {w(
                  "I checked the source evidence and scope.",
                  "He revisado las evidencias y el alcance.",
                  "我已核对原文证据和分析范围。",
                )}
              </label>
              <button
                disabled={!canEdit || !reviewed || saved || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(
                      `/api/tasks/${task.id}/review`,
                      {
                        messageId: latest.id,
                        refs: latest.citations.map((c) => c.ref),
                      },
                      "PUT",
                    );
                    await refresh();
                    setReviewed(false);
                  } catch (e) {
                    setError(taskError((e as Error).message, w));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {saved
                  ? w("Review saved", "Revisión guardada", "核对已保存")
                  : w("Save review", "Guardar revisión", "保存核对")}
              </button>
            </div>
          )}
          {!task.archivedAt && (
            <div className="task-composer">
              <label>
                {w("Continue this task", "Continuar tarea", "继续这个任务")}
                <textarea aria-label={w("Continue this task","Continuar tarea","继续这个任务")}
                  maxLength={4000}
                  rows={4}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    nonce.current = "";
                  }}
                  disabled={!canWrite || working || busy}
                />
              </label>
              <div className="au-model-control">
                <BandPicker value={band} onChange={setBand} />
                <button
                  className="workspace-primary"
                  disabled={!canWrite || working || busy || !text.trim()}
                  onClick={() => void send()}
                >
                  {w("Send follow-up", "Enviar seguimiento", "发送后续目标")}
                </button>
              </div>
              <small>
                {w(
                  "Each turn uses paid AI steps. Saved context and results remain available across devices.",
                  "Cada turno usa pasos de IA de pago. El contexto se conserva entre dispositivos.",
                  "每轮对话消耗 AI 额度；任务上下文和结果会跨设备保存。",
                )}
              </small>
            </div>
          )}
        </>
      )}
      {archiveDialog && (
        <WorkspaceDialog
          title={
            task.archivedAt
              ? w("Restore task", "Restaurar tarea", "恢复任务")
              : w("Remove failed task", "Retirar tarea fallida", "移除失败任务")
          }
          onClose={() => setArchiveDialog(false)}
        >
          <p>
            {w(
              "The task leaves the active list. Sources, billing and audit records are retained.",
              "La tarea sale de la lista activa; conservamos fuentes, facturación y auditoría.",
              "任务从当前列表移除，来源、计费和审计记录继续保留。",
            )}
          </p>
          <label>
            {w("Operation reason", "Motivo", "操作原因")}
            <textarea aria-label={w("Operation reason","Motivo","操作原因")}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            disabled={busy || reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/api/tasks/${task.id}/archive`, {
                  archived: !task.archivedAt,
                  reason,
                });
                setArchiveDialog(false);
                setReason("");
                await refresh();
              } catch (e) {
                setError(taskError((e as Error).message, w));
              } finally {
                setBusy(false);
              }
            }}
          >
            {w("Confirm", "Confirmar", "确认")}
          </button>
        </WorkspaceDialog>
      )}
      {evidence && (
        <WorkspaceDialog
          title={w("Source evidence", "Evidencia original", "原文证据")}
          onClose={() => setEvidence(null)}
        >
          <p>{evidence.author}</p>
          <pre translate="no">{evidence.text}</pre>
        </WorkspaceDialog>
      )}
    </section>
  );
}
export function TaskPreferences({
  token,
  apiBase,
}: {
  token: string;
  apiBase: string;
}) {
  const { w } = useWorkspaceLanguage(),
    api = useTaskApi(token, apiBase);
  const [value, setValue] = useState<Preference | null>(null),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void api<Preference>("/api/task-preferences")
      .then((v) => {
        if (live) setValue(v);
      })
      .catch((e) => {
        if (live) setStatus(e.message);
      });
    return () => {
      live = false;
    };
  }, [token]);
  return (
    <section className="workspace-card">
      <h2>{w("Task defaults", "Preferencias de tareas", "任务默认偏好")}</h2>
      {status && <p role="status">{status}</p>}
      {value && (
        <>
          <label>
            {w("Default goal", "Objetivo predeterminado", "默认目标")}
            <textarea aria-label={w("Default goal","Objetivo predeterminado","默认目标")}
              rows={3}
              value={value.goal}
              maxLength={4000}
              onChange={(e) => setValue({ ...value, goal: e.target.value })}
            />
          </label>
          <label>
            {w("Default scenario", "Escenario predeterminado", "默认使用场景")}
            <select
              value={value.persona}
              onChange={(e) =>
                setValue({ ...value, persona: e.target.value as Persona })
              }
            >
              <option value="creators">
                {w("Creators", "Creadores", "创作者")}
              </option>
              <option value="sellers">
                {w("Sellers", "Vendedores", "卖家")}
              </option>
              <option value="community-hosts">
                {w("Community hosts", "Comunidades", "社群主理人")}
              </option>
            </select>
          </label>
          <BandPicker
            value={value.modelBand}
            onChange={(modelBand) => setValue({ ...value, modelBand })}
          />
          <label>
            {w("Output language", "Idioma del resultado", "结果语言")}
            <select
              value={value.language}
              onChange={(e) =>
                setValue({
                  ...value,
                  language: e.target.value as Preference["language"],
                })
              }
            >
              <option value="en">English</option>
              <option value="zh">中文</option>
              <option value="es">Español</option>
            </select>
          </label>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setValue(
                  await api<Preference>("/api/task-preferences", value, "PUT"),
                );
                setStatus(
                  w(
                    "Defaults saved across devices.",
                    "Preferencias guardadas entre dispositivos.",
                    "默认偏好已保存，可跨设备使用。",
                  ),
                );
              } catch (e) {
                setStatus((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {w("Save defaults", "Guardar preferencias", "保存默认偏好")}
          </button>
        </>
      )}
    </section>
  );
}

export function TaskResults({
  token,
  apiBase,
  onOpen,
}: {
  token: string;
  apiBase: string;
  onOpen: (id: string) => void;
}) {
  const { w } = useWorkspaceLanguage(),
    api = useTaskApi(token, apiBase);
  const [rows, setRows] = useState<Task[]>([]),
    [error, setError] = useState(""),
    [offset, setOffset] = useState(0);
  async function load(page = 0) {
    try {
      setRows(
        await api<Task[]>(
          `/api/tasks?kind=conversation&status=completed&offset=${page}`,
        ),
      );
      setOffset(page);
      setError("");
    } catch (e) {
      setError(taskError((e as Error).message, w));
    }
  }
  useEffect(() => {
    void load();
  }, [token]);
  return (
    <section className="workspace-card">
      <h2>
        {w(
          "Conversation results",
          "Resultados de conversaciones",
          "对话任务结果",
        )}
      </h2>
      {error && <p role="alert">{error}</p>}
      {rows.map((row) => (
        <article className="workspace-row" key={row.id}>
          <strong>{row.goal}</strong>
          <button onClick={() => onOpen(row.id)}>
            {w("Open result", "Abrir resultado", "打开结果")}
          </button>
        </article>
      ))}
      {!rows.length && !error && (
        <p>
          {w(
            "Completed goal-based results will appear here.",
            "Los resultados de tus objetivos aparecerán aquí.",
            "已完成的自由目标结果将保存在这里。",
          )}
        </p>
      )}
      <div className="workspace-button-row">
        <button disabled={!offset} onClick={() => void load(offset - 50)}>
          {w("Previous", "Anterior", "上一页")}
        </button>
        <button
          disabled={rows.length < 50}
          onClick={() => void load(offset + 50)}
        >
          {w("Next", "Siguiente", "下一页")}
        </button>
        <button onClick={() => void load(offset)}>
          {w("Refresh", "Actualizar", "刷新")}
        </button>
      </div>
    </section>
  );
}

function taskStatus(
  status: string,
  w: ReturnType<typeof useWorkspaceLanguage>["w"],
) {
  return (
    (
      {
        ready: w("Needs your input", "Necesita tu respuesta", "等待你的补充"),
        queued: w("Waiting", "En espera", "等待处理"),
        running: w("Working", "Procesando", "处理中"),
        completed: w("Completed", "Completada", "已完成"),
        failed: w("Needs attention", "Requiere atención", "需要处理"),
      } as Record<string, string>
    )[status] ?? status
  );
}

function taskError(
  message: string,
  w: ReturnType<typeof useWorkspaceLanguage>["w"],
) {
  return (
    (
      {
        empty: w(
          "Add at least one item.",
          "Añade al menos un elemento.",
          "请至少填写一条素材。",
        ),
        headers: w(
          "CSV needs a text, comment, review or title column.",
          "CSV necesita una columna text, comment, review o title.",
          "CSV 需要 text、comment、review 或 title 列。",
        ),
        quotes: w(
          "Check the CSV quotation marks.",
          "Revisa las comillas del CSV.",
          "请检查 CSV 引号格式。",
        ),
        count: w(
          "Use at most 5,000 items.",
          "Usa como máximo 5000 elementos.",
          "每批最多 5,000 条。",
        ),
        length: w(
          "Each item must be at most 2,000 characters.",
          "Cada elemento admite hasta 2000 caracteres.",
          "每条素材最多 2,000 字符。",
        ),
        size: w(
          "Use data under 2 MiB.",
          "Usa datos de menos de 2 MiB.",
          "素材需小于 2 MiB。",
        ),
        file_read_failed: w(
          "The file could not be read. Choose it again.",
          "No se pudo leer el archivo. Elígelo de nuevo.",
          "无法读取文件，请重新选择。",
        ),
        task_version_conflict: w(
          "The task changed on another device. Review the latest context and send again.",
          "La tarea cambió en otro dispositivo. Revisa y vuelve a enviar.",
          "任务已在其他设备上更新，请核对最新上下文后重发。",
        ),
        task_turn_in_progress: w(
          "A reply is still running. Wait before sending another goal.",
          "Hay una respuesta en curso. Espera antes de enviar.",
          "上一轮仍在处理中，请等待完成。",
        ),
        automation_paused: w(
          "Review your plan and available credits before continuing.",
          "Revisa tu plan y créditos para continuar.",
          "请检查套餐和可用额度后继续。",
        ),
        task_sources_not_ready: w(
          "Some sources are not ready. Review their import status first.",
          "Hay fuentes pendientes. Revisa su importación.",
          "部分素材尚未就绪，请先检查导入状态。",
        ),
      } as Record<string, string>
    )[message] ?? message
  );
}
