import type { ReactNode } from "react";
import { subtleButton } from "./ui";

// A button that opens the file dialog: a label styled as a button around a visually hidden
// input. The input is cleared after each pick so choosing the same file again fires onChange.
export default function FilePicker({ accept, disabled, onFile, children }: { accept: string; disabled?: boolean; onFile: (file: File) => void; children: ReactNode }) {
  return (
    <label className={`${subtleButton} cursor-pointer ${disabled ? "opacity-40" : ""}`}>
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
