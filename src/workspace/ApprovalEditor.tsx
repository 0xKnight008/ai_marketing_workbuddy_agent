import { useEffect, useState } from "react";
import { useWorkspaceLanguage } from "./useWorkspaceLanguage";
import type { WorkspaceApproval } from "./Overview";
export function ApprovalEditor({
  approval,
  token,
  apiBase,
  onSaved,
  onEditing,
}: {
  approval: WorkspaceApproval;
  token: string;
  apiBase: string;
  onSaved: (a: WorkspaceApproval) => void;
  onEditing?: (v: boolean) => void;
}) {
  const { w } = useWorkspaceLanguage();
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const p = approval.requestedAction.parameters;
  const actions = Array.isArray(approval.requestedAction.actions)
    ? (approval.requestedAction.actions as Array<{
        stepOrder: number;
        content: string;
      }>)
    : [];
  const [texts, setTexts] = useState<string[]>([]),
    [subject, setSubject] = useState("");
  useEffect(() => {
    setEditing(false);
    setError("");
  }, [approval.id, approval.version]);
  useEffect(() => {
    onEditing?.(editing);
  }, [editing]);
  const editable = actions.length > 0 || typeof p?.content === "string";
  if (!editable) return null;
  return (
    <section className="approval-editor">
      {!editing ? (
        <button
          type="button"
          onClick={() => {
            setTexts(
              actions.length
                ? actions.map((a) => a.content)
                : [p?.content ?? ""],
            );
            setSubject(p?.subject ?? "");
            setEditing(true);
          }}
        >
          {w("Edit content", "Editar contenido", "手动编辑内容")}
        </button>
      ) : (
        <>
          <p>
            {w(
              "Edit the outgoing message. Destination and report attachments stay unchanged. Save, then review the new version before approving.",
              "Edita el mensaje saliente. El destino y los adjuntos se conservan. Guarda y revisa la nueva versión antes de aprobar.",
              "编辑待发送内容，发送目标及报告附件保持原样。保存后需重新核对新版本再批准。",
            )}
          </p>
          {p?.channel === "email" && (
            <label>
              {w("Email subject", "Asunto del correo", "邮件主题")}
              <input
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
          )}
          {texts.map((text, i) => (
            <label key={i}>
              {w("Message", "Mensaje", "正文")} {texts.length > 1 ? i + 1 : ""}
              <textarea
                aria-label={w("Message", "Mensaje", "正文")+(texts.length>1?` ${i+1}`:'')}
                maxLength={12000}
                value={text}
                onChange={(e) =>
                  setTexts((a) =>
                    a.map((v, n) => (n === i ? e.target.value : v)),
                  )
                }
              />
            </label>
          ))}
          {error && (
            <p role="alert">
              {w(
                "Not saved. If another reviewer changed this request, refresh before retrying.",
                "No se guardó. Si otro revisor cambió la solicitud, actualiza antes de reintentar.",
                "保存未完成。如其他审核者已修改，请刷新请求后重试。",
              )}{" "}
              <code>{error}</code>
            </p>
          )}
          <div className="workspace-button-row">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              {w("Cancel edit", "Cancelar edición", "取消编辑")}
            </button>
            <button
              type="button"
              className="workspace-primary"
              disabled={
                busy ||
                texts.some((t) => !t.trim()) ||
                (p?.channel === "email" && !subject.trim())
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const response = await fetch(
                    apiBase + `/api/approval-requests/${approval.id}/content`,
                    {
                      method: "PUT",
                      headers: {
                        authorization: `Bearer ${token}`,
                        "content-type": "application/json",
                      },
                      body: JSON.stringify({
                        expectedVersion: approval.version ?? 1,
                        ...(actions.length
                          ? {
                              actions: actions.map((a, i) => ({
                                stepOrder: a.stepOrder,
                                content: texts[i],
                              })),
                            }
                          : {
                              content: texts[0],
                              ...(p?.channel === "email" ? { subject } : {}),
                            }),
                      }),
                    },
                  );
                  const result = await response.json();
                  if (!response.ok)
                    throw new Error(result.error ?? "approval_edit_failed");
                  onSaved({ ...approval, ...result });
                  setEditing(false);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy
                ? w("Saving…", "Guardando…", "保存中…")
                : w("Save new version", "Guardar nueva versión", "保存新版本")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
