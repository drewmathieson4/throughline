import { Link } from "react-router";
import type { SynthesisRosterRow } from "../../worker/api-types";
import { dateFormat, plural } from "../ui";
import { needsRun } from "./reportsStore";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import type { Colour } from "@/lib/avatar";
import { cn } from "@/lib/utils";

const STATUS: Record<SynthesisRosterRow["status"], { text: string; style: string }> = {
  current: { text: "Up to date", style: "bg-mint text-mint-foreground" },
  stale: { text: "Out of date", style: "bg-sunny text-sunny-foreground" },
  none: { text: "Not yet", style: "bg-secondary text-secondary-foreground" },
  empty: { text: "No evidence", style: "bg-muted text-muted-foreground" },
};

// The line under the pill: when it was made, or what changed since.
function detail(r: SynthesisRosterRow): string | null {
  const made = r.createdAt ? dateFormat.format(new Date(r.createdAt)) : null;
  if (r.status === "current") return made;
  if (r.status === "stale") return r.newNotes > 0 ? plural(r.newNotes, "new note") : "Evidence changed";
  return null;
}

// Each student with their summary's status; the row opens the report, and the button beside
// it makes a missing or out-of-date one.
export default function ReportRoster({
  rows,
  classId,
  colour,
  selectedId,
  running,
  disabled,
  onGenerate,
}: {
  rows: SynthesisRosterRow[];
  classId: string;
  colour: Colour;
  selectedId: string | undefined;
  running: Set<string>;
  /** A class run is going, or the roster is for another period. */
  disabled: boolean;
  onGenerate: (studentId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-[22px] border border-border bg-card px-5 py-8 text-center">
        <p className="text-[15px] font-bold">No students yet</p>
        <p className="mt-1.5 text-[13.5px] text-muted-foreground">
          Add students to this class from{" "}
          <Link to={`/classes/${classId}`} className="font-bold text-accent-foreground hover:underline">
            Classes
          </Link>
          .
        </p>
      </div>
    );
  }
  return (
    <ul className="overflow-hidden rounded-[22px] border border-border bg-card">
      {rows.map((r) => {
        const name = `${r.firstName} ${r.lastName}`;
        const selected = r.studentId === selectedId;
        const busy = running.has(r.studentId);
        const line = detail(r);
        return (
          <li key={r.studentId} className={cn("flex items-center gap-2 border-b border-muted py-2 pr-2.5 pl-2 last:border-b-0", selected && "bg-accent")}>
            <Link to={`/reports/${classId}/${r.studentId}`} aria-current={selected ? "page" : undefined} className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 hover:bg-muted/60">
              <Avatar colour={colour} name={name} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-bold">{name}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-bold", STATUS[r.status].style)}>{STATUS[r.status].text}</span>
                  {line && <span className="text-xs text-muted-foreground">{line}</span>}
                </span>
              </span>
            </Link>
            {needsRun(r) && (
              <Button type="button" variant="outline" size="sm" className="border-ring/60 text-accent-foreground" disabled={busy || disabled} onClick={() => onGenerate(r.studentId)}>
                {busy && <span className="size-3 animate-spin rounded-full border-2 border-accent border-t-primary" aria-hidden />}
                {busy ? "Generating…" : "Generate"}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
