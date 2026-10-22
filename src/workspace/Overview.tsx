import { ExecutionHistory } from "./ModelControls";
import { t } from "./translate";
import { useState } from "react";
import { useWorkspaceLanguage } from "./useWorkspaceLanguage";
import { WorkspaceDialog } from "./Shell";
export interface WorkspaceReport {
  id: string;
  title: string;
  template: string;
  status: string;
  createdAt: string;
  itemCount: number;
}
export interface WorkspaceApproval {
  runId?: string | null;
  id: string;
  requestedAt: string;
  requestedAction: {
    summary?: string;
    parameters?: {
      content?: string;
      subject?: string;
      to?: string;
      email?: string;
      channel?: string;
      accountId?: string;
      connectedAccountId?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}
export function ApprovalQueue({
  approvals,
  onDecision,
  token,
  apiBase = "",
}: {
  token?: string;
  apiBase?: string;
  approvals: WorkspaceApproval[];
  onDecision: (
    id: string,
    decision: "approved" | "rejected",
    reason?: string,
  ) => Promise<boolean>;
}) {
  const { w } = useWorkspaceLanguage();
  const [confirm, setConfirm] = useState<{
    approval: WorkspaceApproval;
    decision: "approved" | "rejected";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [reason, setReason] = useState("");
  const snapshot = (a: WorkspaceApproval) => {
    const p = a.requestedAction.parameters;
    return (
      <>
        <dl className="approval-meta">
          <dt>{w("Destination", "Destino", "发送目标")}</dt>
          <dd>
            {String(
              p?.targetLabel ||
                p?.target ||
                p?.to ||
                p?.email ||
                p?.connectedAccountId ||
                p?.accountId ||
                w(
                  "See action details below",
                  "Consulta los detalles de la acción",
                  "请查看下方操作详情",
                ),
            )}
          </dd>
          {p?.subject && (
            <>
              <dt>{w("Email subject", "Asunto del correo", "邮件主题")}</dt>
              <dd>{p.subject}</dd>
            </>
          )}
        </dl>
        <p>
          {w(
            "Exact message to be sent:",
            "Mensaje exacto que se enviará:",
            "即将发送的确切内容：",
          )}
        </p>
        <pre className="approval-snapshot" translate="no">
          {p?.content || JSON.stringify(a.requestedAction, null, 2)}
        </pre>
      </>
    );
  };
  return (
    <>
      <p className="workspace-intro">
        {w(
          "Check the destination and original content. Your decision applies to this request only.",
          "Comprueba el destino y el contenido original. Tu decisión solo afecta a esta solicitud.",
          "核对目标与原文。决定仅适用于此请求。",
        )}
      </p>
      {!approvals.length && (
        <section className="workspace-card">
          <h2>{w("All caught up", "Todo al día", "暂无待审核事项")}</h2>
          <p>
            {w(
              "New requests will appear here.",
              "Las nuevas solicitudes aparecerán aquí.",
              "新请求会在这里显示。",
            )}
          </p>
        </section>
      )}
      {approvals.map((a) => (
        <article className="workspace-card" key={a.id}>
          <h2>
            {a.requestedAction.summary ||
              w("Approval request", "Solicitud de aprobación", "审批请求")}
          </h2>
          {snapshot(a)}
          {token &&
            (a.runId ||
              typeof a.requestedAction.parameters?.reportId === "string") && (
              <ExecutionHistory
                token={token}
                apiBase={apiBase}
                kind={a.runId ? "workflow" : "report"}
                id={a.runId ?? String(a.requestedAction.parameters?.reportId)}
              />
            )}
          <div className="workspace-button-row">
            <button
              className="workspace-primary"
              onClick={() => {
                setFailure("");
                setReason("");
                setConfirm({ approval: a, decision: "approved" });
              }}
            >
              {w("Approve", "Aprobar", "批准")}
            </button>
            <button
              onClick={() => {
                setFailure("");
                setReason("");
                setConfirm({ approval: a, decision: "rejected" });
              }}
            >
              {w("Reject", "Rechazar", "拒绝")}
            </button>
          </div>
        </article>
      ))}
      {confirm && (
        <WorkspaceDialog
          title={
            confirm.decision === "approved"
              ? w("Confirm approval", "Confirmar aprobación", "确认批准")
              : w("Confirm rejection", "Confirmar rechazo", "确认拒绝")
          }
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          {snapshot(confirm.approval)}
          <p>
            {w(
              "Approval allows the backend to execute this exact request. Rejection prevents this request from proceeding.",
              "La aprobación permite ejecutar esta solicitud exacta. El rechazo impide que continúe.",
              "批准后后端可执行此请求；拒绝将阻止此请求继续。",
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
          {failure && <p role="alert">{failure}</p>}
          <button
            disabled={busy}
            className="workspace-primary"
            onClick={async () => {
              setBusy(true);
              setFailure("");
              try {
                if (
                  await onDecision(
                    confirm.approval.id,
                    confirm.decision,
                    reason.trim() || undefined,
                  )
                )
                  setConfirm(null);
                else
                  setFailure(
                    w(
                      "The decision was not confirmed. Your note is preserved; refresh the request and retry.",
                      "No se confirmó la decisión. Conservamos tu nota; actualiza la solicitud y reintenta.",
                      "决定尚未确认，备注已保留；请刷新请求后重试。",
                    ),
                  );
              } catch {
                setFailure(
                  w(
                    "Connection failed. Retry to confirm the saved decision.",
                    "Error de conexión. Reintenta para confirmar la decisión guardada.",
                    "连接失败，请重试确认决定是否已保存。",
                  ),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? w("Saving…", "Guardando…", "保存中…")
              : w("Confirm decision", "Confirmar decisión", "确认决定")}
          </button>
        </WorkspaceDialog>
      )}
    </>
  );
}
export function ReportLibrary({
  reports,
  onOpen,
}: {
  reports: WorkspaceReport[];
  onOpen: (id: string) => void;
}) {
  const { w, locale } = useWorkspaceLanguage();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const filtered = reports.filter(
    (r) =>
      r.title
        .toLocaleLowerCase(locale)
        .includes(query.toLocaleLowerCase(locale)) &&
      (!filter || r.template === filter),
  );
  return (
    <section className="workspace-card">
      <div className="workspace-filters">
        <label>
          {w("Search reports", "Buscar informes", "搜索报告")}
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          {w("Template", "Plantilla", "模板")}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">
              {w("All templates", "Todas las plantillas", "全部模板")}
            </option>
            {[...new Set(reports.map((r) => r.template))].map((t) => (
              <option key={t} value={t}>
                {(
                  {
                    content_recap: w(
                      "Content recap",
                      "Resumen de contenido",
                      "内容复盘",
                    ),
                    comment_insights: w(
                      "Comment insights",
                      "Análisis de comentarios",
                      "评论洞察",
                    ),
                    product_opportunities: w(
                      "Product opportunities",
                      "Oportunidades de producto",
                      "商品机会",
                    ),
                    review_attribution: w(
                      "Review attribution",
                      "Análisis de reseñas",
                      "评价归因",
                    ),
                    community_digest: w(
                      "Community digest",
                      "Resumen de comunidad",
                      "社群摘要",
                    ),
                    daily_ops: w("Daily tasks", "Tareas diarias", "每日任务"),
                  } as Record<string, string>
                )[t] || t}
              </option>
            ))}
          </select>
        </label>
      </div>
      {filtered.map((r) => (
        <div className="workspace-row" key={r.id}>
          <div>
            <strong>{r.title}</strong>
            <small>
              {new Date(r.createdAt).toLocaleString(locale)} · {t(r.status)}
            </small>
          </div>
          <button onClick={() => onOpen(r.id)}>
            {w("Open report", "Abrir informe", "打开报告")}
          </button>
        </div>
      ))}
      {!filtered.length && (
        <p role="status">
          {w(
            "No reports match your filters.",
            "Ningún informe coincide con tus filtros.",
            "没有匹配的报告。",
          )}
        </p>
      )}
    </section>
  );
}
