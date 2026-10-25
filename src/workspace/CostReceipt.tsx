import { useWorkspaceLanguage } from "./useWorkspaceLanguage";
export type CostReceipt = {
  id: string;
  subjectId?: string;
  band: string;
  state: string;
  maxCredits: number;
  heldCredits: number;
  settledCredits: number;
  releasedCredits: number;
  actualModels: string[];
};
export function CostReceiptView({ receipt }: { receipt: CostReceipt }) {
  const { w } = useWorkspaceLanguage();
  const state =
    receipt.state === "reconciliation"
      ? w(
          "Usage reconciliation pending",
          "Conciliación pendiente",
          "用量待对账",
        )
      : receipt.state === "refunded"
        ? w("Refunded", "Reembolsado", "已退款")
        : receipt.state === "settled"
          ? w("Settled", "Liquidado", "已结算")
          : w("Reserved", "Reservado", "已预留");
  return (
    <div role="note" className="model-execution">
      <strong>
        {w("AI billing receipt", "Recibo de IA", "AI 计费收据")} · {state}
      </strong>
      <p>
        {w("Selected model", "Modelo seleccionado", "所选模型")}: {receipt.band}{" "}
        · {w("Actual model", "Modelo real", "实际模型")}:{" "}
        {receipt.actualModels?.join(" / ") || "—"}
      </p>
      <p>
        {w("Maximum", "Máximo", "最高预算")}: {receipt.maxCredits} ·{" "}
        {w("Reserved", "Reservado", "预留")}: {receipt.heldCredits} ·{" "}
        {w("Settled", "Liquidado", "已结算")}: {receipt.settledCredits} ·{" "}
        {w("Released / refunded", "Liberado / reembolsado", "已释放／退款")}:{" "}
        {receipt.releasedCredits} credits
      </p>
    </div>
  );
}
