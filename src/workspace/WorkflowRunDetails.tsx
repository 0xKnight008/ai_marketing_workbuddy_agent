import { useEffect, useState } from "react";
import { useWorkspaceLanguage } from "./useWorkspaceLanguage";
import { ExecutionHistory } from "./ModelControls";
export type RunDetails = {
  id: string;
  status: string;
  modelBand?: string;
  failure?: null | { kind: string; issues: string[] };
  drafts?: Array<{ platform: string; content: string; hashtags: string[] }>;
};
export function RunDiagnostics({ run }: { run: RunDetails }) {
  const { w } = useWorkspaceLanguage();
  return (
    <>
      {run.failure && (
        <section className="workspace-card" role="alert">
          <h3>
            {run.failure.kind === "provider_auth"
              ? w(
                  "Model provider authentication failed",
                  "Falló la autenticación del proveedor",
                  "模型供应商鉴权失败",
                )
              : run.failure.kind === "content_blocked"
                ? w(
                    "Content needs correction before review",
                    "Corrige el contenido antes de revisarlo",
                    "内容需修正后才能进入审核",
                  )
                : w(
                    "Generation failed before review",
                    "La generación falló antes de la revisión",
                    "生成失败，尚未进入审核",
                  )}
          </h3>
          <p>
            {run.failure.kind === "provider_auth"
              ? w(
                  "The selected provider rejected its server credential. An administrator must update that provider credential before retrying this model.",
                  "El proveedor rechazó la credencial del servidor. Un administrador debe corregirla antes de reintentar.",
                  "所选供应商拒绝了服务器凭据。管理员需更新该供应商凭据后才能重试此模型。",
                )
              : run.failure.kind === "content_blocked"
                ? w(
                    "AI generation completed, but publication checks blocked this draft. It has not been submitted for approval or published.",
                    "La generación terminó, pero los controles bloquearon el borrador. No se envió a revisión ni se publicó.",
                    "AI 已完成生成，但草稿未通过发布校验，因此尚未进入人工审核或发布。",
                  )
                : w(
                    "No approval was created. Review the execution details before starting another task.",
                    "No se creó una aprobación. Revisa la ejecución antes de iniciar otra tarea.",
                    "尚未创建审核记录，请先查看执行详情再新建任务。",
                  )}
          </p>
          {run.failure.issues.length > 0 && (
            <ul>
              {run.failure.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      {!!run.drafts?.length && (
        <details className="workspace-card">
          <summary>
            {w("Generated drafts", "Borradores generados", "已生成的草稿")}
          </summary>
          {run.drafts.map((draft, i) => (
            <article key={i}>
              <h4>{draft.platform}</h4>
              <pre
                style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                translate="no"
              >
                {[draft.content, ...draft.hashtags].filter(Boolean).join(" ")}
              </pre>
            </article>
          ))}
        </details>
      )}
    </>
  );
}
export function WorkflowRunDetails({
  token,
  apiBase,
  id,
  status,
}: {
  token: string;
  apiBase: string;
  id: string;
  status: string;
}) {
  const { w } = useWorkspaceLanguage();
  const [run, setRun] = useState<RunDetails | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setRun(null);
    setFailed(false);
    void fetch(`${apiBase}/api/runs/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const value = await r.json();
        if (live) setRun(value);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [token, apiBase, id, status]);
  return (
    <>
      {failed && (
        <p role="status">
          {w(
            "Execution details could not be loaded.",
            "No se pudo cargar la ejecución.",
            "暂时无法读取执行详情。",
          )}
        </p>
      )}
      {run && (
        <>
          <p>
            {w("Selected model", "Modelo seleccionado", "选择的模型")}:{" "}
            {run.modelBand ?? "—"}
          </p>
          <ExecutionHistory
            token={token}
            apiBase={apiBase}
            kind="workflow"
            id={run.id}
            requested={run.modelBand}
          />
          <RunDiagnostics run={run} />
        </>
      )}
    </>
  );
}
