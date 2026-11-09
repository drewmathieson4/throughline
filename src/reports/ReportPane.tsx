import { useEffect, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import type { SynthesisRosterRow, SynthesisView } from "../../worker/api-types";
import { api, messageOf } from "../api";
import { CappedNotice } from "../auth/CappedNotice";
import { useAllowance } from "../auth/allowanceStore";
import { calendarDay, dateFormat, errorText } from "../ui";
import Report from "./Report";
import { needsRun, type Range } from "./reportsStore";
import Summary from "./Summary";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Colour } from "@/lib/avatar";
import { cn } from "@/lib/utils";

export type PaneTab = "evidence" | "report";

// A student with no evidence for the period: gathering it, nothing to gather, or the button.
// Both tabs show it; the report tab adds a line saying why.
export function EvidenceEmpty({ row, running, disabled, onGenerate, lead }: { row: SynthesisRosterRow; running: boolean; disabled: boolean; onGenerate: () => void; lead?: ReactNode }) {
  const { capped } = useAllowance();
  return (
    <div className="mt-[22px] px-5 py-8 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
        {running ? <span className="size-6 animate-spin rounded-full border-[3px] border-ring/40 border-t-primary" aria-hidden /> : <Sparkles className="size-6" aria-hidden />}
      </span>
      {running ? (
        <p className="mt-3 text-base font-extrabold">Gathering evidence…</p>
      ) : needsRun(row) ? (
        <>
          <p className="mt-3 text-base font-extrabold">No evidence yet</p>
          {lead && <p className="mx-auto mt-1.5 max-w-[34ch] text-[13.5px] text-muted-foreground">{lead}</p>}
          {capped ? (
            <CappedNotice className="mt-4" />
          ) : (
            <Button type="button" className="mt-4" disabled={disabled} onClick={onGenerate}>
              <Sparkles aria-hidden />
              Gather evidence
            </Button>
          )}
        </>
      ) : (
        <p className="mt-3 text-base font-extrabold">No evidence in this period</p>
      )}
    </div>
  );
}

// The open student: the evidence (the cited summary) on one tab, the report written from it
// on the other. It fetches the summary the roster row points at, so one made by a class run,
// or regenerated, shows up as soon as the roster catches up.
export default function ReportPane({
  row,
  range,
  classId,
  colour,
  tab,
  onTab,
  running,
  disabled,
  onGenerate,
  onWrite,
  onRecorded,
}: {
  row: SynthesisRosterRow;
  /** The period the roster was loaded for. */
  range: Range;
  classId: string;
  colour: Colour;
  tab: PaneTab;
  onTab: (tab: PaneTab) => void;
  running: boolean;
  disabled: boolean;
  onGenerate: (period: Range) => void;
  onWrite: () => void;
  onRecorded: () => void;
}) {
  const [loaded, setLoaded] = useState<SynthesisView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = row.synthesisId;

  useEffect(() => {
    if (!id) return;
    let latest = true;
    api<SynthesisView>(`/api/syntheses/${id}`)
      .then((s) => {
        if (!latest) return;
        setLoaded(s);
        setError(null);
      })
      .catch((e) => latest && setError(messageOf(e)));
    return () => {
      latest = false;
    };
  }, [id]);

  const shown = loaded && loaded.id === id ? loaded : null;
  const name = `${row.firstName} ${row.lastName}`;
  const period = shown
    ? `${calendarDay(shown.periodStart)} – ${calendarDay(shown.periodEnd)} · evidence from ${dateFormat.format(new Date(shown.createdAt))}`
    : `${calendarDay(range.from)} – ${calendarDay(range.to)}`;

  const evidence = shown ? (
    <Summary
      synthesis={shown}
      classId={classId}
      stale={row.status === "stale"}
      newNotes={row.newNotes}
      regenerating={running}
      onRegenerate={() => onGenerate({ from: shown.periodStart, to: shown.periodEnd })}
      onRecorded={onRecorded}
    />
  ) : id ? (
    !error && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
  ) : (
    <EvidenceEmpty row={row} running={running} disabled={disabled} onGenerate={() => onGenerate(range)} />
  );

  return (
    <article className="rounded-3xl border border-border bg-card p-5 md:p-7">
      <div className="flex items-center gap-3.5">
        <Avatar colour={colour} name={name} size={56} />
        <div className="min-w-0">
          <h2 className="text-2xl font-extrabold tracking-[-0.02em]">{name}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{period}</p>
        </div>
      </div>
      {error && <p className={cn("mt-3", errorText)}>{error}</p>}

      <Tabs value={tab} onValueChange={(v) => onTab(v as PaneTab)} className="mt-[18px]">
        <TabsList className="h-auto bg-track p-1">
          <TabsTrigger value="evidence" className="h-[38px] px-[18px] font-bold">
            Evidence
          </TabsTrigger>
          <TabsTrigger value="report" className="h-[38px] px-[18px] font-bold">
            Report
            {row.reportId && <span className="size-2 rounded-full bg-mint-dot" aria-label="written" />}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="evidence">{evidence}</TabsContent>
        <TabsContent value="report">
          {id ? (
            <Report row={row} classId={classId} disabled={disabled} onWrite={onWrite} />
          ) : (
            <EvidenceEmpty row={row} running={running} disabled={disabled} onGenerate={() => onGenerate(range)} lead="A report is written from the evidence, so gather that first." />
          )}
        </TabsContent>
      </Tabs>
    </article>
  );
}
