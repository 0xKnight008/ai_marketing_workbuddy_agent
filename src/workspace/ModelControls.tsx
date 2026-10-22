import { useEffect, useRef, useState } from "react";
import { useWorkspaceLanguage } from "./useWorkspaceLanguage";
import { WorkspaceDialog } from "./Shell";
type Band = "eco" | "standard" | "flagship";
export type ModelExecution = {
  step: number;
  band: Band | null;
  provider: string | null;
  credits: string | number;
};
type Choice = {
  label?: string;
  id: string;
  kind: string;
  taskId: string | null;
  requestedBand: Band;
  reason: string;
  availableCredits: number;
  choices: Band[];
};
const names = { eco: "Eco", standard: "Standard", flagship: "Flagship" };
const costs = { eco: 1, standard: 6, flagship: 20 };
export function ExecutionSummary({
  executions,
  requested,
}: {
  executions: ModelExecution[];
  requested?: string;
}) {
  const { w } = useWorkspaceLanguage();
  if (!executions?.length) return null;
  const bands = [
    ...new Set(
      executions.map((e) =>
        e.band ? names[e.band] : w("Unknown", "Desconocido", "未知"),
      ),
    ),
  ];
  return (
    <div className="model-execution" role="note">
      <strong>
        {w("Actual execution", "Ejecución real", "实际执行档位")}:{" "}
        {bands.join(" / ")}
      </strong>
      {requested && (
        <span>
          {" "}
          · {w("Requested", "Solicitado", "所选档位")}:{" "}
          {names[requested as Band] ?? requested}
        </span>
      )}
      <p>
        {executions.length}{" "}
        {w("paid model steps", "pasos de modelo de pago", "个已计费模型步骤")} ·{" "}
        {executions.reduce((n, e) => n + Number(e.credits), 0)} AI credits
      </p>
      {requested && executions.some((e) => e.band && e.band !== requested) && (
        <p>
          {w(
            "The executed band differs from the original selection. This history includes any earlier automatic downgrade and later confirmed model changes.",
            "El nivel ejecutado difiere de la selección original. El historial incluye reducciones automáticas anteriores y cambios confirmados.",
            "实际执行与最初选择不同；历史记录可能包含旧版自动降档或之后确认的模型更改。",
          )}
        </p>
      )}
    </div>
  );
}
export function ExecutionHistory({
  token,
  apiBase,
  kind,
  id,
  requested,
}: {
  token: string;
  apiBase: string;
  kind: string;
  id: string;
  requested?: string;
}) {
  const [rows, setRows] = useState<ModelExecution[]>([]);
  const { w } = useWorkspaceLanguage();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setRows([]);
    setFailed(false);
    fetch(`${apiBase}/api/model-executions/${kind}/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (live && Array.isArray(data)) setRows(data);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [token, apiBase, kind, id]);
  return failed ? (
    <p role="status">
      {w(
        "Execution details could not be loaded.",
        "No se pudieron cargar los detalles de ejecución.",
        "暂时无法读取实际执行记录。",
      )}
    </p>
  ) : (
    <ExecutionSummary executions={rows} requested={requested} />
  );
}
export function ModelChoiceQueue({
  token,
  apiBase,
  role,
  onChange,
}: {
  token: string;
  apiBase: string;
  role: string;
  onChange: () => void;
}) {
  const { w } = useWorkspaceLanguage();
  const [rows, setRows] = useState<Choice[]>([]),
    [choice, setChoice] = useState<Choice | null>(null),
    [band, setBand] = useState<Band>("eco"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true);
  async function load() {
    const r = await fetch(`${apiBase}/api/model-choices`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!r.ok) throw new Error();
    const data = await r.json();
    if (mounted.current && Array.isArray(data)) setRows(data);
  }
  useEffect(() => {
    mounted.current = true;
    void load().catch(() => {});
    const timer = setInterval(() => void load().catch(() => {}), 3000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [token, apiBase]);
  useEffect(() => {
    if (!choice) return;
    const current = rows.find((row) => row.id === choice.id);
    if (current) {
      setChoice(current);
      if (!current.choices.includes(band)) setBand(current.choices[0] ?? band);
    }
  }, [rows]);
  const kind = (k: string) =>
    ({
      "task.turn": w("Conversation", "Conversación", "任务对话"),
      "import.classify": w(
        "Source classification",
        "Clasificación de fuentes",
        "素材分类",
      ),
      "insight.generate": w("Report", "Informe", "报告"),
      "topics.cluster": w("Topic grouping", "Agrupación de temas", "主题归类"),
      prepare_ai_run: w(
        "Publishing draft",
        "Borrador de publicación",
        "发布草稿",
      ),
    })[k] ?? k;
  if (!rows.length && !choice) return null;
  return (
    <section
      className="workspace-card model-choice-queue"
      aria-label={w(
        "Model confirmation",
        "Confirmación de modelo",
        "模型改档确认",
      )}
    >
      <h2>
        {w(
          "Your model choice is needed",
          "Confirma el modelo",
          "请确认模型选择",
        )}
      </h2>
      <p>
        {w(
          "Nothing will switch models or consume further AI credits until you confirm. Completed paid steps are retained.",
          "No cambiaremos de modelo ni consumiremos más créditos en estas tareas hasta que confirmes. Conservamos los pasos ya pagados.",
          "这些任务在确认前不会切换模型或继续消耗 AI 额度；已完成的付费步骤会保留。",
        )}
      </p>
      {rows.map((row) => (
        <div className="workspace-row" key={row.id}>
          <div>
            <strong>
              {kind(row.kind)} · {names[row.requestedBand]}
            </strong>
            <p>{row.label}</p>
            <small>{row.taskId ?? row.id}</small>
            <p>
              {row.reason === 'trial_payment' ? w('Your subscription payment must be confirmed before this task can continue. The owner can resolve payment in Plan & usage, then resume the original model.','Debemos confirmar el pago de la suscripción. El titular puede resolverlo en Plan y consumo y reanudar el modelo original.','正式订阅付款尚未确认。请工作区所有者在“套餐与用量”处理付款，再恢复原模型任务。') : row.reason === "task_quota"
                ? w(
                    "Your task quota requires Eco.",
                    "Tu cuota requiere Eco.",
                    "当前任务配额要求使用 Eco。",
                  )
                : w(
                    `The selected model needs ${costs[row.requestedBand]} credits per step; ${row.availableCredits} available.`,
                    `El modelo necesita ${costs[row.requestedBand]} créditos por paso; tienes ${row.availableCredits}.`,
                    `所选模型每步需要 ${costs[row.requestedBand]} credits，当前可用 ${row.availableCredits}。`,
                  )}
            </p>
          </div>
          <button
            disabled={role === "viewer" || (row.reason==='trial_payment' && role!=='owner')}
            onClick={() => {
              setChoice(row);
              setBand(row.choices[0] ?? row.requestedBand);
              setError("");
            }}
          >
            {row.reason==='trial_payment' ? w('Review subscription payment','Revisar pago de suscripción','确认订阅付款') : w("Review model choice", "Revisar modelo", "确认使用模型")}
          </button>
        </div>
      ))}
      <a href="#billing">{w("Plan & usage", "Plan y consumo", "套餐与用量")}</a>
      {choice && (
        <WorkspaceDialog
          title={choice.reason==='trial_payment' ? w('Confirm subscription billing & continue','Confirmar cobro y continuar','确认订阅扣费并继续') : w(
            "Confirm the model for this task",
            "Confirma el modelo de esta tarea",
            "确认此任务使用的模型",
          )}
          onClose={() => {
            if (!busy) setChoice(null);
          }}
        >
          <p>
            {w(
              "This choice applies to the remaining model steps of this job. It does not change your saved defaults.",
              "La selección se aplica a los pasos restantes de esta tarea; no cambia tus preferencias.",
              "本次选择仅适用于此任务剩余的模型步骤，不修改默认偏好。",
            )}
          </p>
          {choice.reason!=='trial_payment' && <label>
            {w("Available model", "Modelo disponible", "可用模型")}
            <select
              value={band}
              onChange={(e) => setBand(e.target.value as Band)}
              disabled={busy || !choice.choices.length}
            >
              {choice.choices.map((b) => (
                <option key={b} value={b}>
                  {names[b]} · {costs[b]} credits/{w("step", "paso", "步")}
                </option>
              ))}
            </select>
          </label>}
          {!choice.choices.length && choice.reason!=="trial_payment" && (
            <p>
              {w(
                "No model is currently affordable. Review your plan and credits.",
                "No hay modelos disponibles con el saldo actual. Revisa el plan y los créditos.",
                "当前额度不足以执行任何模型，请先检查套餐与额度。",
              )}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="workspace-button-row">
            <button disabled={busy} onClick={() => setChoice(null)}>
              {w("Keep waiting", "Seguir esperando", "暂不更改")}
            </button>
            <button
              className="workspace-primary"
              disabled={busy || (choice.reason!=="trial_payment" && !choice.choices.includes(band))}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const r = await fetch(
                    `${apiBase}/api/model-choices/${choice.id}`,
                    {
                      method: "POST",
                      headers: {
                        authorization: `Bearer ${token}`,
                        "content-type": "application/json",
                      },
                      body: JSON.stringify({
                        modelBand: band,
                        requestId: crypto.randomUUID(),
                        reason: choice.reason==='trial_payment' ? `Owner confirmed subscription billing and resuming ${band}` : `User explicitly confirmed ${band} for remaining model steps`,
                      }),
                    },
                  );
                  if (!r.ok) throw new Error();
                  setChoice(null);
                  await load();
                  onChange();
                } catch {
                  setError(
                    w(
                      "The choice was not confirmed. Refresh the available choices and retry.",
                      "No se confirmó el cambio. Actualiza las opciones y reintenta.",
                      "模型选择尚未确认，请刷新可用选项后重试。",
                    ),
                  );
                  await load().catch(() => {});
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy
                ? w("Saving…", "Guardando…", "保存中…")
                : choice.reason==='trial_payment' ? w('Confirm billing & resume original model','Confirmar cobro y reanudar modelo original','确认扣费并恢复原模型') : w(
                    "Confirm model & continue",
                    "Confirmar modelo y continuar",
                    "确认模型并继续",
                  )}
            </button>
          </div>
        </WorkspaceDialog>
      )}
    </section>
  );
}
