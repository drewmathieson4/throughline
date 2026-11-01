import { Sparkles } from "lucide-react";
import { Link } from "react-router";
import type { ClassRow } from "../../worker/db/schema";
import { CappedNotice } from "../auth/CappedNotice";
import { useAllowance } from "../auth/allowanceStore";
import { useNotes } from "../notes/notesStore";
import { chipOff, chipOn, chipRow, errorText, plural } from "../ui";
import { runBusy, sameRange, validRange, wholeYear, type ClassRun, type Range } from "./reportsStore";
import { Avatar } from "@/components/Avatar";
import { PageTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// The top of Reports: the class pills (the only class switcher in the app), the period, and
// the class run. The count on the button is the only warning before a run, per the
// no-confirm rule. A demo visitor's count stops at what they have left; at none, the way on
// is to sign in. With the AI paused (the spend cap), the button says so instead.
export default function ReportsControls({
  classes,
  cls,
  range,
  onRange,
  pending,
  ready,
  run,
  onGenerateClass,
}: {
  classes: ClassRow[];
  cls: ClassRow;
  range: Range;
  onRange: (range: Range) => void;
  /** Students with no summary, or an out-of-date one, for the period. */
  pending: number;
  /** False while the roster for the period shown is still loading. */
  ready: boolean;
  run: ClassRun | null;
  onGenerateClass: () => void;
}) {
  const { colourOf } = useNotes();
  const { demo, capped: noFresh } = useAllowance();
  const year = wholeYear(cls);
  const isYear = sameRange(range, year);
  const busyRun = runBusy(run) ? run : null;
  const busy = busyRun !== null;
  const count = demo ? Math.min(pending, demo.reportsLeft) : pending;
  const capped = noFresh && pending > 0 && !busy;

  return (
    <>
      <PageTitle>Reports</PageTitle>
      <nav aria-label="Class" className={chipRow}>
        {classes.map((c) => (
          <Link
            key={c.id}
            to={`/reports/${c.id}`}
            aria-current={c.id === cls.id ? "page" : undefined}
            className={cn("inline-flex min-h-[42px] flex-none items-center gap-2 rounded-full border pr-4 pl-1.5 text-sm font-bold", c.id === cls.id ? chipOn : chipOff)}
          >
            <Avatar colour={colourOf(c.id)} name={c.name} size={30} />
            {c.name}
          </Link>
        ))}
      </nav>

      <div className="mt-4 flex flex-wrap items-end gap-2.5">
        <Label>
          From
          <Input type="date" className="w-auto" value={range.from} onChange={(e) => onRange({ ...range, from: e.target.value })} />
        </Label>
        <Label>
          To
          <Input type="date" className="w-auto" value={range.to} onChange={(e) => onRange({ ...range, to: e.target.value })} />
        </Label>
        <button
          type="button"
          aria-pressed={isYear}
          onClick={() => onRange(year)}
          className={cn(
            "min-h-11 rounded-full border px-4 text-[13.5px] font-bold",
            isYear ? "border-primary bg-accent text-accent-foreground" : chipOff,
          )}
        >
          Whole year
        </button>
        <span className="flex-1" />
        {capped ? (
          <CappedNotice className="min-h-11" />
        ) : (
          <Button type="button" className="min-h-11" disabled={!validRange(range) || !ready || busy || count === 0} onClick={onGenerateClass}>
            <Sparkles aria-hidden />
            {busy ? `Generating ${busyRun.done} of ${busyRun.total}…` : `Generate for class (${count})`}
          </Button>
        )}
      </div>
      {!validRange(range) && <p className={cn("mt-2", errorText)}>Pick a start date on or before the end date.</p>}
      {busy && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-accent" role="progressbar" aria-label="Summaries made" aria-valuemin={0} aria-valuemax={busyRun.total} aria-valuenow={busyRun.done}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.round((busyRun.done / busyRun.total) * 100)}%` }} />
        </div>
      )}
      {!busy && run && run.failed > 0 && <p className={cn("mt-2", errorText)}>{plural(run.failed, "summary")} could not be made; try those again.</p>}
    </>
  );
}
