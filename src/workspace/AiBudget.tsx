import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { WorkspaceDialog } from "./Shell";
import { useWorkspaceLanguage } from "./useWorkspaceLanguage";
type Quote = {
  subscriptionPaymentRequired?: boolean;
  mode: string;
  quoteId?: string;
  estimatedCredits: number;
  maxCredits: number;
  expiresAt?: string;
};
type Pending = {
  quote: Quote;
  kind: string;
  band: string;
  url: string;
  headers: HeadersInit | undefined;
  resolve: (quote: Quote | null) => void;
  reject: (error: Error) => void;
};
const BudgetFetch = createContext<typeof fetch>((input, init) =>
  globalThis.fetch(input, init),
);
export const useAiBudgetFetch = () => useContext(BudgetFetch);
function kindFor(
  path: string,
  payload: Record<string, unknown>,
): string | undefined {
  if (/\/api\/tasks\/[^/]+\/messages$/.test(path)) return "task.turn";
  if (path.endsWith("/api/imports")) return "import.classify";
  if (path.endsWith("/api/insights")) return "insight.generate";
  if (path.endsWith("/api/topics/runs")) return "topics.cluster";
  if (/\/api\/pipelines\/[^/]+\/activate$/.test(path)) return "prepare_ai_run";
  if (path.endsWith("/api/runs")) return "prepare_ai_run";
  if (/\/api\/model-choices\/[^/]+$/.test(path))
    return typeof payload._aiKind === "string" ? payload._aiKind : undefined;
  return;
}
export function AiBudgetProvider({ children }: { children: ReactNode }) {
  const { w } = useWorkspaceLanguage();
  const [pending, setPending] = useState<Pending | null>(null),
    [maximum, setMaximum] = useState(1),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;
  useEffect(
    () => () => {
      pendingRef.current?.resolve(null);
    },
    [],
  );
  const request: typeof fetch = async (input, init) => {
    if (init?.method !== "POST" || typeof init.body !== "string")
      return globalThis.fetch(input, init);
    const url = new URL(String(input), location.href),
      payload = JSON.parse(init.body),
      kind = kindFor(url.pathname, payload);
    const band = payload.modelBand ?? payload.input?.modelBand;
    if (!kind || !["eco", "standard", "flagship"].includes(band))
      return globalThis.fetch(input, init);
    const quoteUrl = url.origin + "/api/billing/ai-quote";
    const response = await globalThis.fetch(quoteUrl, {
      method: "POST",
      headers: init.headers,
      body: JSON.stringify({ kind, modelBand: band }),
      cache: "no-store",
    });
    if (response.status === 404) return globalThis.fetch(input, init); // an older gateway only supports legacy billing
    const quote = await response.json();
    if (!response.ok) throw new Error(quote.error ?? "ai_quote_unavailable");
    if (!quote.quoteId) return globalThis.fetch(input, init);
    let accepted: Quote | null = quote;
    if (quote.mode === "cost-v1") {
      if (lock.current) throw new Error("ai_budget_confirmation_in_progress");
      lock.current = true;
      try {
        accepted = await new Promise<Quote | null>((resolve, reject) => {
          setMaximum(quote.maxCredits);
          setPending({
            quote,
            kind,
            band,
            url: quoteUrl,
            headers: init.headers,
            resolve,
            reject,
          });
        });
      } finally {
        lock.current = false;
      }
    }
    if (!accepted) throw new Error("ai_budget_not_confirmed");
    delete payload._aiKind;
    payload.aiQuoteId = accepted.quoteId;
    return globalThis.fetch(input, { ...init, body: JSON.stringify(payload) });
  };
  return (
    <BudgetFetch.Provider value={request}>
      {children}
      {pending && (
        <WorkspaceDialog
          title={w(
            "Confirm AI budget",
            "Confirmar presupuesto de IA",
            "确认 AI 预算",
          )}
          onClose={() => {
            pending.resolve(null);
            setPending(null);
          }}
        >
          {pending.quote.subscriptionPaymentRequired && (
            <p role="alert">
              {w(
                "This budget exceeds your trial balance. Continuing starts billing your selected subscription; the task runs only after payment succeeds.",
                "Este presupuesto supera tu saldo de prueba. Continuar inicia el cobro del plan elegido; la tarea se ejecuta tras confirmar el pago.",
                "本次预算超过试用余额；继续将启动已选订阅套餐扣费，付款成功后才执行任务。",
              )}
            </p>
          )}
          <p>
            {w("Selected model", "Modelo seleccionado", "所选模型")}:{" "}
            <strong>{pending.band}</strong>
          </p>
          <p>
            {w("Estimated credits", "Créditos estimados", "预计额度")}:{" "}
            {Math.min(pending.quote.estimatedCredits, maximum)}
          </p>
          <label>
            {w(
              "Maximum credits for this operation",
              "Máximo de créditos para esta operación",
              "本次操作最高额度",
            )}
            <input
              type="number"
              min="1"
              max="1000000"
              value={maximum}
              onChange={(e) => setMaximum(Number(e.target.value))}
            />
          </label>
          <p>
            {w(
              "We reserve this maximum and settle valid saved results using actual model costs. Unused credits are released. The model will not be changed automatically.",
              "Reservamos este máximo y cobramos los resultados válidos guardados según el costo real. Liberamos el saldo no usado. No cambiamos el modelo automáticamente.",
              "先预留最高额度，再按实际模型成本结算已保存的有效结果，未使用部分退回；不会自动更换模型。",
            )}
          </p>
          <p>
            {w(
              "Multi-step work pauses before another model call if the confirmed budget cannot cover it.",
              "El trabajo se pausa antes de otra llamada si el presupuesto confirmado no alcanza.",
              "预算不足以覆盖下一次调用时会暂停，待你确认后再继续。",
            )}
          </p>
          <button
            disabled={busy || !Number.isInteger(maximum) || maximum < 1}
            onClick={async () => {
              setBusy(true);
              try {
                let quote = pending.quote;
                if (
                  maximum !== quote.maxCredits ||
                  (quote.expiresAt && Date.parse(quote.expiresAt) <= Date.now())
                ) {
                  const r = await globalThis.fetch(pending.url, {
                    method: "POST",
                    headers: pending.headers,
                    body: JSON.stringify({
                      kind: pending.kind,
                      modelBand: pending.band,
                      maxCredits: maximum,
                    }),
                    cache: "no-store",
                  });
                  quote = await r.json();
                  if (!r.ok) throw new Error("ai_quote_unavailable");
                  if (
                    quote.subscriptionPaymentRequired &&
                    !pending.quote.subscriptionPaymentRequired
                  ) {
                    setPending({ ...pending, quote });
                    return;
                  }
                }
                pending.resolve(quote);
                setPending(null);
              } catch (error) {
                pending.reject(
                  error instanceof Error
                    ? error
                    : new Error("ai_quote_unavailable"),
                );
                setPending(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            {w(
              "Confirm budget and continue",
              "Confirmar y continuar",
              "确认预算并继续",
            )}
          </button>
        </WorkspaceDialog>
      )}
    </BudgetFetch.Provider>
  );
}
