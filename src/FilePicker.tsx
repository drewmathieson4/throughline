import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

// A button that opens the file dialog: a label styled as a button around a visually hidden
// input. The input is cleared after each pick so choosing the same file again fires onChange.
export default function FilePicker({ accept, disabled, onFile, className, children }: { accept: string; disabled?: boolean; onFile: (file: File) => void; className?: string; children: ReactNode }) {
  return (
    <label className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer has-focus-visible:ring-3 has-focus-visible:ring-ring/50", disabled && "pointer-events-none opacity-50", className)}>
      {children}
      <input
        type="file"
        className="sr-only"
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}
