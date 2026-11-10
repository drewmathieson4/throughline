import type { ReactNode } from "react";
import { errorText } from "@/ui";
import { useAction } from "@/useAction";
import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";

// A Panel that asks once before something destructive: what goes (the children), Cancel, and
// a destructive button that runs onConfirm and shows its failure under the text. Closing on
// success is the caller's: a confirm that succeeds usually leaves the page behind. A form, so
// Enter in a child input confirms; `disabled` holds the button until the caller is satisfied.
export function ConfirmPanel({
  open,
  onClose,
  title,
  children,
  confirmLabel = "Delete",
  busyLabel = "Deleting…",
  onConfirm,
  disabled = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  confirmLabel?: string;
  busyLabel?: string;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
}) {
  const { run, busy, error } = useAction(onConfirm);
  return (
    <Panel open={open} onOpenChange={(o) => !o && onClose()} title={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled && !busy) void run();
        }}
        className="mt-2 flex flex-col gap-3"
      >
        {children}
        {error && <p className={errorText}>{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={busy || disabled}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
