import { useState } from "react";
import { at } from "../admin/i18n";
type Row = Record<string, unknown>;
const columns = [
  "id",
  "subjectId",
  "kind",
  "band",
  "mode",
  "state",
  "maxCredits",
  "heldCredits",
  "settledCredits",
  "releasedCredits",
  "supplierCostNanos",
  "unknownReceipts",
  "policyVersion",
  "rateVersion",
  "actualModels",
  "createdAt",
];
const cell = (value: unknown) => {
  let s = Array.isArray(value)
    ? value.join(" / ")
    : value == null
      ? ""
      : String(value);
  if (/^\s*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export default function AdminAiCosts({
  request,
}: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
}) {
  const [workspace, setWorkspace] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="mt-8 border-t pt-5">
      <h3>{at("AI cost reconciliation")}</h3>
      <p>
        {at(
          "Cost records are separate from provider token records. Unknown usage is not zero cost.",
        )}
      </p>
      <label>
        {at("Workspace UUID")}
        <input
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          className="m-2 rounded border p-2"
        />
      </label>
      <button
        disabled={busy || !/^[0-9a-f-]{36}$/i.test(workspace)}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await request(
              "/api/admin/ai-costs?workspaceId=" +
                encodeURIComponent(workspace),
            );
            const data = await r.json();
            if (!r.ok || !Array.isArray(data))
              throw new Error("Could not load AI costs.");
            setRows(data);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {at("Load costs")}
      </button>
      <button
        disabled={!rows.length}
        className="ml-4"
        onClick={() => {
          const csv = [
            columns.map(cell).join(","),
            ...rows.map((row) => columns.map((k) => cell(row[k])).join(",")),
          ].join("\r\n");
          const url = URL.createObjectURL(
            new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = "ai-cost-reconciliation-latest-100.csv";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        {at("Download latest 100 costs CSV")}
      </button>
      {error && <p role="alert">{at(error)}</p>}
      <p>
        {at(
          "Up to 100 latest operations. Supplier cost is in USD nanounits (1 USD = 1,000,000,000).",
        )}
      </p>
      {!!rows.length && (
        <div className="overflow-x-auto">
          <table aria-label={at("AI cost reconciliation")}>
            <thead>
              <tr>
                {columns.map((k) => (
                  <th key={k} className="p-2">
                    {at(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)}>
                  {columns.map((k) => (
                    <td key={k} className="p-2 text-xs">
                      {Array.isArray(row[k])
                        ? (row[k] as string[]).join(" / ")
                        : row[k] == null
                          ? "—"
                          : String(row[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
