import { useEffect, useRef, useState } from "react";
import { at } from "./i18n";
export function ActionReasonDialog({
  action,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  action: { path: string; body: Record<string, unknown> };
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [reason, setReason] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      className="admin-reason"
      ref={dialog}
      aria-labelledby="admin-reason-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="admin-reason-title">{at("Confirm administrative action")}</h2>
      <p>
        {at(
          "A reason is required and will be recorded with the operator and target.",
        )}
      </p>
      <pre className="whitespace-pre-wrap break-all">
        {action.path}
        {"\n"}
        {JSON.stringify(action.body, null, 2)}
      </pre>
      <label>
        {at("Operation reason")}
        <textarea aria-label={at("Operation reason")}
          autoFocus
          rows={4}
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={busy || reason.trim().length < 3}
        onClick={() => onConfirm(reason.trim())}
      >
        {at("Confirm")}
      </button>
      <button disabled={busy} onClick={onCancel}>
        {at("Cancel")}
      </button>
    </dialog>
  );
}
