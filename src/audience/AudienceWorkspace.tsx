import { ReportDatasetStats } from "../components/ReportDatasetStats";
import { useEffect, useRef, useState } from "react";
import {
  AUDIENCES,
  audience,
  type Audience,
} from "../../platform/src/contracts/audience";
import {
  reportHighlights,
  type Highlight,
} from "../../platform/src/contracts/report-highlights";
import {
  parseCsv,
  csvRecordToItem,
  pasteToItems,
} from "../../platform/src/import-service/csv";
import { uniqueImportItems } from "../../platform/src/import-service/deduplicate";
import { previewImport } from "../workspace/import-preview";
import { WorkspaceDialog } from "../workspace/Shell";
import { useWorkspaceLanguage } from "../workspace/useWorkspaceLanguage";
import { AUDIENCE_TEMPLATE, audienceCopy, samples } from "./copy";
import "./audience-workspace.css";

type Report = {
  id: string;
  template: string;
  title: string;
  status: string;
  batchIds: string[];
  itemCount: number;
  report: Record<string, unknown> | null;
  error?: string | null;
};
type Batch = { id: string; label: string; status: string; itemCount: number };
type Review = { reviewed: true; selectedKeys: string[]; updatedAt: string };
type ReviewResponse = { review: Review | null; canEdit: boolean };
type Stage =
  | "input"
  | "preview"
  | "classifying"
  | "ready"
  | "generating"
  | "result"
  | "library";
export function AudienceWorkspace({
  token,
  apiBase,
  workspaceId,
  role,
  canRun,
  onFullReport,
  onUsageChange,
}: {
  token: string;
  apiBase: string;
  workspaceId: string;
  role: string;
  canRun: boolean;
  onFullReport: (id: string) => void;
  onUsageChange: () => void;
}) {
  const { locale, w } = useWorkspaceLanguage();
  const [persona, setPersona] = useState<Audience | undefined>(
    () =>
      audience(location.hash.split("/")[1]) ??
      audience(new URLSearchParams(location.search).get("persona")),
  );
  const [stage, setStage] = useState<Stage>("input");
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState("");
  const [text, setText] = useState("");
  const [source, setSource] = useState<"paste" | "csv">("paste");
  const [deduplicate, setDeduplicate] = useState(true);
  const [rows, setRows] = useState<string[]>([]);
  const [rawCount, setRawCount] = useState(0);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [saved, setSaved] = useState<Review | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [reviewLoaded, setReviewLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<{ aiCreditsAvailable: number } | null>(
    null,
  );
  const [quote, setQuote] = useState<{
    ref: string;
    text: string;
    full: boolean;
  } | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const evidenceRequest = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const navigation = useRef(0);
  const copy = persona ? audienceCopy[persona][locale] : null;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const allowed =
    canRun && ["owner", "admin", "editor", "approver"].includes(role);
  const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers,
      signal: abort.current?.signal,
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        response.status === 402
          ? w(
              "Subscription or AI credits are unavailable. Open Plan & usage; your input is retained.",
              "Revisa tu suscripción y créditos; conservamos el texto.",
              "订阅或 AI credits 不可用，请查看套餐与用量；输入已保留。",
            )
          : response.status === 401
            ? w(
                "Your session expired. Sign in again.",
                "Tu sesión caducó. Inicia sesión.",
                "会话已过期，请重新登录。",
              )
            : response.status === 403
              ? w(
                  "Your role cannot perform this action.",
                  "Tu rol no permite esta acción.",
                  "当前角色无权执行此操作。",
                )
              : (value.message ??
                value.error ??
                w(
                  "Request failed. Refresh the report library before creating another paid request.",
                  "La solicitud falló. Revisa la biblioteca antes de repetir.",
                  "请求失败，请先刷新报告库确认是否已受理，再决定是否重新提交。",
                )),
      );
    return value as T;
  };
  const refresh = async () => {
    const [list, imports, balance] = await Promise.all([
      api<Report[]>("/api/insights"),
      api<Batch[]>("/api/imports"),
      ["owner", "admin", "viewer"].includes(role)
        ? api<{ aiCreditsAvailable: number }>("/api/billing/usage")
        : Promise.resolve(null),
    ]);
    setReports(list);
    setBatches(imports);
    setUsage(balance);
  };
  const openReport = async (id: string, push = true) => {
    setError("");
    setReviewLoaded(false);
    setSaved(null);
    setSelected([]);
    setReviewed(false);
    setBusy(true);
    const request = ++navigation.current;
    try {
      const value = await api<Report>(
        `/api/insights/${encodeURIComponent(id)}`,
      );
      if (request !== navigation.current) return;
      const match = AUDIENCES.find(
        (p) => AUDIENCE_TEMPLATE[p] === value.template,
      );
      if (!match)
        throw new Error(
          w(
            "Choose a report from one of these three scenarios.",
            "Elige un informe de estos tres escenarios.",
            "请选择这三类场景对应的报告。",
          ),
        );
      setPersona(match);
      setReport(value);
      setStage(value.status === "generated" ? "result" : "generating");
      if (push) history.pushState(null, "", `#start/${match}/${value.id}`);
      if (value.status === "generated") {
        const result = await api<ReviewResponse>(
          `/api/insights/${value.id}/review`,
        );
        if (request !== navigation.current) return;
        setSaved(result.review);
        setSelected(result.review?.selectedKeys ?? []);
        setReviewed(Boolean(result.review));
        setCanEdit(result.canEdit);
        setReviewLoaded(true);
      }
    } catch (e) {
      if (request === navigation.current) setError((e as Error).message);
    } finally {
      if (request === navigation.current) setBusy(false);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    void refresh().catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    const restore = () => {
      const parts = location.hash.split("/");
      const id = parts[2];
      if (parts[0] === "#start" && id) void openReport(id, false);
      else {
        ++navigation.current;
        setBusy(false);
        setPersona(
          audience(parts[1]) ??
            audience(new URLSearchParams(location.search).get("persona")),
        );
        setStage("input");
        setReport(null);
      }
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => {
      controller.abort();
      ++navigation.current;
      window.removeEventListener("popstate", restore);
    };
    // The parent remounts this component for each authenticated workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, workspaceId]);
  useEffect(() => {
    if (stage !== "classifying" || !batch || batch.status === "failed") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<{ batch: Batch }>(`/api/imports/${batch.id}`);
        if (stopped) return;
        setBatch(result.batch);
        if (result.batch.status === "classified") {
          setStage("ready");
          void refresh().catch(() => {});
          onUsageChange();
          return;
        }
        if (result.batch.status === "failed") {
          setError(
            w(
              "Classification failed. Your batch is saved. Check Sources before starting another paid import.",
              "La clasificación falló. Revisa Fuentes antes de repetir.",
              "分类失败，批次已保存。请先在数据来源中检查，再决定是否重新付费导入。",
            ),
          );
          return;
        }
        timer = setTimeout(poll, 2500);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, batch?.id]);
  useEffect(() => {
    if (stage !== "generating" || !report || report.status === "failed") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<Report>(`/api/insights/${report.id}`);
        if (stopped) return;
        setReport(result);
        if (result.status === "generated") {
          await openReport(result.id, false);
          onUsageChange();
          return;
        }
        if (result.status === "failed") {
          setError(
            result.error ??
              w("Generation failed.", "La generación falló.", "生成失败。"),
          );
          return;
        }
        timer = setTimeout(poll, 2500);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, report?.id]);
  const choose = (p: Audience) => {
    ++navigation.current;
    setPersona(p);
    setStage("input");
    setReport(null);
    setBatch(null);
    setSaved(null);
    setError("");
    setLabel("");
    setScope("");
    setText("");
    setBusy(false);
    history.pushState(null, "", `#start/${p}`);
  };
  function preview() {
    try {
      if (!label.trim() || !scope.trim())
        throw new Error(
          w(
            "Add a source name and scope first.",
            "Añade un nombre y un alcance.",
            "请填写素材名称与范围。",
          ),
        );
      previewImport(text, source);
      const parsed =
        source === "csv"
          ? parseCsv(text)
              .map(csvRecordToItem)
              .filter((v): v is NonNullable<typeof v> => Boolean(v))
          : pasteToItems(text);
      const items = deduplicate ? uniqueImportItems(parsed) : parsed;
      if (!items.length)
        throw new Error(
          w(
            "No valid text found.",
            "No hay texto válido.",
            "没有可分析的文本。",
          ),
        );
      setRawCount(parsed.length);
      setRows(items.map((i) => i.text));
      setStage("preview");
      setError("");
    } catch (e) {
      setError(
        w(
          "Check your input (name, scope, CSV headers, 2 MiB / 5,000 rows / 2,000 characters per row).",
          "Revisa el nombre, alcance, encabezados y límites del archivo.",
          "请检查名称、范围与 CSV 表头；上限为 2 MiB / 5,000 条 / 单条 2,000 字符。",
        ) + ` (${(e as Error).message})`,
      );
    }
  }
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (!abort.current?.signal.aborted) setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const importData = () =>
    run(async () => {
      const request = navigation.current;
      const result = await api<Batch>("/api/imports", {
        method: "POST",
        body: JSON.stringify({
          label: `${label.trim()} · ${scope.trim()}`,
          sourceType: source,
          content: text,
          deduplicate,
          modelBand: "eco",
        }),
      });
      if (request !== navigation.current) return;
      setBatch(result);
      setStage(result.status === "classified" ? "ready" : "classifying");
      onUsageChange();
    });
  const generate = () =>
    run(async () => {
      if (!persona || !batch || batch.status !== "classified") return;
      const request = navigation.current;
      const result = await api<Report>("/api/insights", {
        method: "POST",
        body: JSON.stringify({
          template: AUDIENCE_TEMPLATE[persona],
          batchIds: [batch.id],
          modelBand: "eco",
          language: locale,
          title: batch.label,
        }),
      });
      if (request !== navigation.current) return;
      setSaved(null);
      setSelected([]);
      setReviewed(false);
      setReviewLoaded(false);
      setReport(result);
      setStage("generating");
      history.pushState(null, "", `#start/${persona}/${result.id}`);
      onUsageChange();
    });
  const save = () =>
    run(async () => {
      if (!report || !reviewed || !reviewLoaded) return;
      const request = navigation.current;
      const result = await api<ReviewResponse>(
        `/api/insights/${report.id}/review`,
        {
          method: "PUT",
          body: JSON.stringify({ reviewed: true, selectedKeys: selected }),
        },
      );
      if (request === navigation.current) setSaved(result.review);
    });
  async function evidence(citation: Highlight["citations"][number]) {
    const request = ++evidenceRequest.current;
    setQuote({ ref: citation.ref, text: citation.snippet, full: false });
    setSourceBusy(true);
    try {
      const map = report?.report?._evidence as
        | Record<string, string>
        | undefined;
      const id = map?.[citation.ref];
      if (id && report) {
        for (const bid of report.batchIds) {
          const detail = await api<{
            items: Array<{ id: string; text: string }>;
          }>(`/api/imports/${bid}`);
          const item = detail.items.find((x) => x.id === id);
          if (item && request === evidenceRequest.current) {
            setQuote({ ref: citation.ref, text: item.text, full: true });
            break;
          }
        }
      }
    } catch {
      /* Keep the verified excerpt visible if the source cannot be read. */
    } finally {
      if (request === evidenceRequest.current) setSourceBusy(false);
    }
  }
  const button = (
    label: string,
    onClick: () => void,
    primary = false,
    disabled = false,
  ) => (
    <button
      className={primary ? "au-button primary" : "au-button"}
      onClick={onClick}
      disabled={busy || disabled}
    >
      {label}
    </button>
  );
  if (!persona || !copy)
    return (
      <section className="audience-workspace workspace-card">
        <h2>
          {w(
            "What would you like to understand first?",
            "¿Qué quieres entender primero?",
            "先从你最关心的素材开始",
          )}
        </h2>
        <p>
          {w(
            "One account, three starting points. You can change this later.",
            "Una cuenta, tres puntos de partida. Puedes cambiar después.",
            "同一个账号，三种起点，之后可以随时切换。",
          )}
        </p>
        <div className="au-choices">
          {AUDIENCES.map((p) => (
            <button key={p} onClick={() => choose(p)}>
              <strong>{audienceCopy[p][locale].name}</strong>
              <span>{audienceCopy[p][locale].report} →</span>
            </button>
          ))}
        </div>
      </section>
    );
  const highlights = reportHighlights(
    report?.template ?? "",
    report?.report ?? null,
  );
  const savedCurrent = Boolean(
    saved &&
      reviewed &&
      JSON.stringify([...saved.selectedKeys].sort()) ===
        JSON.stringify([...selected].sort()),
  );
  const step = ["input", "preview"].includes(stage)
    ? stage === "input"
      ? 1
      : 2
    : stage === "classifying" || stage === "ready"
      ? 2
      : savedCurrent
        ? 4
        : 3;
  return (
    <div className={`audience-workspace au-${persona}`}>
      <div className="au-heading">
        <div>
          <p className="au-eyebrow">{copy.name}</p>
          <h2>{copy.title}</h2>
          <p>
            {w(
              "Start with one useful result. No account connection or workflow builder required.",
              "Empieza con un resultado útil, sin conectar cuentas ni crear flujos.",
              "先完成一次有用分析，不必先连接账号或搭建工作流。",
            )}
          </p>
        </div>
        <label>
          {w("Scenario", "Escenario", "使用场景")}
          <select
            aria-label={w("Scenario", "Escenario", "使用场景")}
            value={persona}
            disabled={busy || stage === "classifying" || stage === "generating"}
            onChange={(e) => choose(e.target.value as Audience)}
          >
            {AUDIENCES.map((p) => (
              <option key={p} value={p}>
                {audienceCopy[p][locale].name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="au-toolbar">
        {button(w("This analysis", "Este análisis", "本次分析"), () =>
          setStage(
            report
              ? report.status === "generated"
                ? "result"
                : "generating"
              : batch
                ? batch.status === "classified"
                  ? "ready"
                  : "classifying"
                : "input",
          ),
        )}
        {button(w("Report library", "Biblioteca", "报告库"), () => {
          setStage("library");
          void refresh().catch((e) => setError(e.message));
        })}
        <a
          href="#billing"
          onClick={(e) => {
            e.preventDefault();
            location.hash = "billing";
            location.reload();
          }}
        >
          {w("Plan & usage", "Plan y uso", "套餐与用量")} ↗
        </a>
      </div>
      {error && (
        <div role="alert" className="au-alert">
          {error}
        </div>
      )}
      {stage !== "library" && (
        <ol className="au-steps">
          {[
            w("Import", "Importar", "导入素材"),
            w("Check scope", "Revisar alcance", "确认范围"),
            w("Read results", "Leer resultados", "查看结果"),
            w("Save & reuse", "Guardar", "保存复用"),
          ].map((name, i) => (
            <li key={name} aria-current={step === i + 1 ? "step" : undefined}>
              <span>{step > i + 1 ? "✓" : i + 1}</span>
              {name}
            </li>
          ))}
        </ol>
      )}
      {stage === "input" && (
        <section className="workspace-card">
          <h3>
            {w(
              "Bring your first source",
              "Trae tus primeros datos",
              "带上你的第一份素材",
            )}
          </h3>
          <div className="au-actions">
            {button(
              w("Use example input", "Usar ejemplo", "使用示例素材"),
              () => {
                setText(samples[persona][locale].join("\n"));
                setLabel(w("Example input", "Ejemplo", "示例素材"));
                setScope(
                  w("Demonstration dataset", "Datos de ejemplo", "演示数据集"),
                );
                setSource("paste");
              },
            )}
            <label className="au-file">
              {w("Upload CSV", "Subir CSV", "上传 CSV")}
              <input
                aria-label="CSV"
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 2 * 1024 * 1024) {
                    setError(
                      w(
                        "Use a file under 2 MiB.",
                        "Usa un archivo menor de 2 MiB.",
                        "请使用小于 2 MiB 的文件。",
                      ),
                    );
                    return;
                  }
                  setText(await file.text());
                  setSource("csv");
                  if (!label) setLabel(file.name.slice(0, 55));
                }}
              />
            </label>
          </div>
          <p className="au-small">
            {w(
              "Examples are input only. Importing and analyzing them uses real AI credits.",
              "Los ejemplos son datos de entrada: su análisis consume créditos reales.",
              "示例仅提供输入素材；导入和分析示例同样消耗真实 AI credits。",
            )}
          </p>
          <div className="au-fields">
            <label>
              {w("Source name", "Nombre", "素材名称")}
              <input
                maxLength={55}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label>
              {w("Date / scope", "Fecha / alcance", "日期 / 素材范围")}
              <input
                maxLength={55}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              />
            </label>
          </div>
          <label>
            {source === "csv"
              ? "CSV"
              : w("One item per line", "Un elemento por línea", "每行一条原文")}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={9}
            />
          </label>
          <label className="au-check">
            <input
              type="checkbox"
              checked={deduplicate}
              onChange={(e) => setDeduplicate(e.target.checked)}
            />
            {w(
              "Remove exact duplicates (including author, platform and metrics)",
              "Eliminar duplicados exactos, incluidos autor, plataforma y métricas",
              "移除完全重复记录（同时比较作者、平台与指标）",
            )}
          </label>
          <div className="au-actions">
            {source === "csv" &&
              button(
                w(
                  "Switch to pasted text",
                  "Usar texto pegado",
                  "切换为粘贴文本",
                ),
                () => setSource("paste"),
              )}
            {button(
              w("Preview scope →", "Revisar alcance →", "预览并确认范围 →"),
              preview,
              true,
            )}
          </div>
        </section>
      )}
      {stage === "preview" && (
        <section className="workspace-card">
          <h3>
            {label} · {scope}
          </h3>
          <div className="au-stats">
            <div>
              <b>{rawCount}</b>
              {w("Input records", "Entradas", "输入记录")}
            </div>
            <div>
              <b>{rawCount - rows.length}</b>
              {w("Duplicates removed", "Duplicados", "已移除重复")}
            </div>
            <div>
              <b>{rows.length}</b>
              {w("Analysis scope", "Alcance", "分析范围")}
            </div>
          </div>
          <ol className="au-preview">
            {rows.slice(0, 5).map((row, i) => (
              <li key={i}>{row}</li>
            ))}
          </ol>
          <p>
            {w(
              "Eco: 1 credit per AI call. Classification and report generation are charged separately; calls depend on batch size and model limits.",
              "Eco: 1 crédito por llamada. La clasificación y el informe se cobran por separado según los datos.",
              "Eco 每次 AI 调用 1 credit。导入分类与报告生成分别计费，调用次数取决于批次大小与模型限制。",
            )}
          </p>
          <p>
            {w("Available credits", "Créditos disponibles", "可用额度")}:{" "}
            {usage?.aiCreditsAvailable ?? "—"}
          </p>
          <div className="au-actions">
            {button(w("Back to edit", "Editar", "返回编辑"), () =>
              setStage("input"),
            )}
            {button(
              w(
                "Confirm paid import →",
                "Confirmar importación →",
                "确认导入并分类 →",
              ),
              () => void importData(),
              true,
              !allowed || (usage !== null && usage.aiCreditsAvailable <= 0),
            )}
          </div>
        </section>
      )}
      {(stage === "classifying" || stage === "ready") && (
        <section className="workspace-card" aria-live="polite">
          <h3>
            {batch?.status === "failed"
              ? w("Classification failed", "Clasificación fallida", "分类失败")
              : stage === "ready"
                ? w("Your sources are ready", "Datos listos", "素材已准备好")
                : w(
                    "Classifying your sources…",
                    "Clasificando…",
                    "正在整理你的素材…",
                  )}
          </h3>
          <p>
            {batch?.label} · {batch?.itemCount} {copy.noun}
          </p>
          <p>
            {w(
              "Generating a report uses additional AI credits (Eco: 1 per call).",
              "Generar el informe consume créditos adicionales (Eco: 1 por llamada).",
              "生成报告会额外消耗 AI credits（Eco 每次调用 1 credit）。",
            )}
          </p>
          <p>
            {w(
              "You can leave this page. The batch is saved in Sources.",
              "Puedes salir. El lote está guardado en Fuentes.",
              "可以离开此页，批次已保存在数据来源中。",
            )}
          </p>
          <div className="au-actions">
            {button(
              w("Check status", "Comprobar estado", "检查状态"),
              () =>
                void run(async () => {
                  if (!batch) return;
                  const value = await api<{ batch: Batch }>(
                    `/api/imports/${batch.id}`,
                  );
                  setBatch(value.batch);
                  if (value.batch.status === "classified") setStage("ready");
                }),
            )}
            {stage === "ready" &&
              button(
                `${w("Generate ", "Generar ", "生成")}${copy.report} →`,
                () => void generate(),
                true,
                !allowed,
              )}
          </div>
        </section>
      )}
      {stage === "generating" && (
        <section className="workspace-card" aria-live="polite">
          <h3>
            {report?.status === "failed"
              ? w("Generation failed", "Generación fallida", "生成失败")
              : w(
                  "Reading your evidence…",
                  "Leyendo evidencias…",
                  "正在阅读你的素材…",
                )}
          </h3>
          <p>{report?.title}</p>
          <p>
            {w(
              "The report is saved in the library. Refresh its status before submitting another paid request.",
              "El informe está en la biblioteca. Comprueba su estado antes de repetir.",
              "报告已保存在报告库中。请先检查状态，再决定是否重新提交付费任务。",
            )}
          </p>
          {button(
            w("Check report status", "Comprobar informe", "检查报告状态"),
            () => {
              if (report) void openReport(report.id, false);
            },
          )}
          {report?.status === "failed" &&
            button(
              w(
                "Choose source for a new attempt",
                "Elegir datos para reintentar",
                "选择素材后重新尝试",
              ),
              () => {
                setStage("library");
                void refresh().catch((e) => setError(e.message));
              },
            )}
        </section>
      )}
      {stage === "result" && report && (
        <section className="workspace-card">
          <p className="au-eyebrow">{copy.report}</p>
          <h3>{report.title}</h3>
          <p>
            {report.itemCount} {copy.noun} ·{" "}
            {w("Saved report", "Informe guardado", "已生成报告")}
          </p>
          {savedCurrent && (
            <div className="au-success" role="status">
              ✓{" "}
              {w(
                "Review saved. Reopen it from the library at any time.",
                "Revisión guardada. Disponible en la biblioteca.",
                "核对与重点已保存，可随时从报告库继续查看。",
              )}
            </div>
          )}
          <ReportDatasetStats value={report.report?._dataset} />
          <p>
            {typeof report.report?.summary === "string"
              ? report.report.summary
              : ""}
          </p>
          {!highlights.length && (
            <p>
              {w(
                "No grounded findings are available in this report. Review the source data.",
                "No hay hallazgos con evidencia. Revisa los datos.",
                "报告没有可展示的有效证据结论，请检查素材。",
              )}
            </p>
          )}
          {highlights.map((h) => (
            <article className="au-insight" key={h.key}>
              <h4>{h.title}</h4>
              {h.detail && <p>{h.detail}</p>}
              {h.citations.map((c, i) => (
                <blockquote key={`${c.ref}-${i}`}>
                  {c.snippet}
                  <button onClick={() => void evidence(c)}>
                    {w("View source", "Ver fuente", "查看原文")} {c.ref} ↗
                  </button>
                </blockquote>
              ))}
              <label className="au-check">
                <input
                  type="checkbox"
                  checked={selected.includes(h.key)}
                  disabled={busy || !canEdit || !reviewLoaded}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, h.key]
                        : selected.filter((k) => k !== h.key),
                    )
                  }
                />
                {copy.select}
              </label>
            </article>
          ))}
          <p className="au-small">
            {copy.hint}{" "}
            {w(
              "Citation counts are not full-dataset frequencies.",
              "Las citas no son frecuencias totales.",
              "引用数量不等于全量主题频次。",
            )}
          </p>
          <label className="au-check">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy || !canEdit || !reviewLoaded}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            {w(
              "I checked the source evidence and analysis scope.",
              "He revisado las fuentes y el alcance.",
              "我已核对原始证据与分析范围。",
            )}
          </label>
          <div className="au-actions">
            {button(
              w(
                "Full report & next actions",
                "Informe completo y acciones",
                "完整报告与后续操作",
              ),
              () => onFullReport(report.id),
            )}
            {button(
              w(
                "Reload saved review",
                "Recargar revisión",
                "重新加载已保存状态",
              ),
              () => void openReport(report.id, false),
            )}
            {button(
              w(
                "Save review & focus",
                "Guardar revisión",
                "保存核对与关注重点",
              ),
              () => void save(),
              true,
              !reviewed || !canEdit || !reviewLoaded,
            )}
          </div>
        </section>
      )}
      {stage === "library" && (
        <section className="workspace-card">
          <h3>
            {copy.report} · {w("Library", "Biblioteca", "报告库")}
          </h3>
          {reports
            .filter((r) => r.template === AUDIENCE_TEMPLATE[persona])
            .map((r) => (
              <article className="au-library" key={r.id}>
                <div>
                  <strong>{r.title}</strong>
                  <p>
                    {r.status} · {r.itemCount} {copy.noun}
                  </p>
                </div>
                {button(
                  w("Open →", "Abrir →", "继续查看 →"),
                  () => void openReport(r.id),
                )}
              </article>
            ))}
          {!reports.some((r) => r.template === AUDIENCE_TEMPLATE[persona]) && (
            <p>
              {w(
                "Your first report starts with one source.",
                "Tu primer informe empieza con una fuente.",
                "第一份报告，从一份素材开始。",
              )}
            </p>
          )}
          {button(w("New analysis +", "Nuevo análisis +", "新建分析 +"), () => {
            setReport(null);
            setBatch(null);
            setSaved(null);
            setStage("input");
            history.pushState(null, "", `#start/${persona}`);
          })}
          <h4>
            {w(
              "Continue from an imported batch",
              "Continuar con un lote",
              "从已导入批次继续",
            )}
          </h4>
          {batches.map((b) => (
            <article className="au-library" key={b.id}>
              <div>
                <strong>{b.label}</strong>
                <p>
                  {b.status} · {b.itemCount}
                </p>
              </div>
              {button(
                w("Use this source", "Usar fuente", "使用这份素材"),
                () => {
                  setBatch(b);
                  setStage(b.status === "classified" ? "ready" : "classifying");
                },
                false,
                b.status === "failed",
              )}
            </article>
          ))}
        </section>
      )}
      {quote && (
        <WorkspaceDialog
          title={`${w("Original evidence", "Evidencia original", "原始证据")} · ${quote.ref}`}
          onClose={() => {
            ++evidenceRequest.current;
            setQuote(null);
          }}
        >
          <p>
            {sourceBusy
              ? w(
                  "Loading the original source…",
                  "Cargando fuente…",
                  "正在读取原文…",
                )
              : quote.full
                ? w(
                    "Full imported text",
                    "Texto importado completo",
                    "完整导入原文",
                  )
                : w(
                    "Verified excerpt. Full source is unavailable.",
                    "Cita verificada. Fuente completa no disponible.",
                    "已验证引用片段，完整原文暂不可用。",
                  )}
          </p>
          <blockquote className="au-quote">{quote.text}</blockquote>
        </WorkspaceDialog>
      )}
    </div>
  );
}
