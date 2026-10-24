import { useState } from "react";
import { ChevronDown, MoveRight, TrendingDown, TrendingUp } from "lucide-react";
import type { GradeSummary, GradeTrend, Standout } from "../../worker/api-types";
import { calendarDay, caption, pct, plural } from "../ui";
import { cn } from "@/lib/utils";

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const trendLook: Record<GradeTrend["label"], { icon: typeof TrendingUp; pill: string }> = {
  rising: { icon: TrendingUp, pill: "bg-mint text-mint-foreground" },
  slipping: { icon: TrendingDown, pill: "bg-coral text-coral-foreground" },
  steady: { icon: MoveRight, pill: "bg-secondary text-secondary-foreground" },
};

function StandoutLine({ label, s }: { label: string; s: Standout }) {
  return (
    <p>
      <span className="font-bold">{label}:</span> {s.assignment}, {pct(s.pct)}
      {s.classMean !== null && <span className="text-muted-foreground"> (class {pct(s.classMean)})</span>}
    </p>
  );
}

function Tile({ label, category, mean, className }: { label: string; category: string; mean: number | null; className: string }) {
  return (
    <div className={cn("rounded-2xl px-3.5 py-3", className)}>
      <p className="text-xs font-bold">{label}</p>
      <p className="mt-0.5 text-base font-extrabold text-foreground">
        {category}
        {mean !== null && ` · ${pct(mean)}`}
      </p>
    </div>
  );
}

// The grade summary computed in the Worker (worker/grades.ts): the headline numbers up top,
// then every score in term order behind "Show all scores".
export default function GradesCard({ grades: g }: { grades: GradeSummary }) {
  const [open, setOpen] = useState(false);
  const meanOf = (category: string) => g.byCategory.find((c) => c.category === category)?.mean ?? null;
  const trend = g.trend && trendLook[g.trend.label];

  return (
    <section aria-labelledby="grades-heading" className="mt-[22px] rounded-[22px] border border-border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <h2 id="grades-heading" className={caption}>
            Grades
          </h2>
          <p className="mt-1.5 text-[44px] leading-none font-extrabold tracking-[-0.04em]">{g.count > 0 ? pct(g.overall) : "No scores yet"}</p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {g.weighted ? "Weighted as the syllabus says · " : ""}
            {plural(g.count, "score")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {g.trend && trend && (
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold", trend.pill)}>
              <trend.icon className="size-4" aria-hidden />
              {capitalise(g.trend.label)} · {pct(g.trend.from)} → {pct(g.trend.to)}
              <span className="sr-only">, first half of the term to the second</span>
            </span>
          )}
          {g.missing > 0 && <span className="rounded-full bg-sunny px-3 py-1.5 text-[13px] font-bold text-sunny-foreground">{g.missing} missing</span>}
        </div>
      </div>

      {g.strongest && g.weakest && (
        <div className="mt-[18px] grid grid-cols-2 gap-2.5">
          <Tile label="Strongest" category={g.strongest} mean={meanOf(g.strongest)} className="bg-mint text-mint-foreground" />
          <Tile label="Weakest" category={g.weakest} mean={meanOf(g.weakest)} className="bg-sunny text-sunny-foreground" />
        </div>
      )}
      {(g.biggestWin || g.biggestLoss) && (
        <div className="mt-3.5 space-y-1 text-sm">
          {g.biggestWin && <StandoutLine label="Biggest win" s={g.biggestWin} />}
          {g.biggestLoss && <StandoutLine label="Biggest loss" s={g.biggestLoss} />}
        </div>
      )}

      {g.entries.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mt-3.5 inline-flex min-h-9 items-center gap-1.5 text-sm font-bold text-accent-foreground"
          >
            {open ? "Hide scores" : `Show all ${plural(g.entries.length, "score")}`}
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && (
            <ul className="mt-1.5">
              {g.entries.map((e) => (
                <li key={e.assignment} className="flex items-center gap-3 border-t border-muted py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{e.assignment}</p>
                    <p className="mt-px text-[12.5px] text-muted-foreground">
                      {[e.category, e.dueDate && `due ${calendarDay(e.dueDate)}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {e.score === null ? (
                    <span className="rounded-full bg-sunny px-2.5 py-1 text-[12.5px] font-bold text-sunny-foreground">Missing</span>
                  ) : (
                    <>
                      <span className="text-[13.5px] text-secondary-foreground tabular-nums">
                        {e.score}/{e.maxScore}
                      </span>
                      <span className="min-w-[52px] rounded-full bg-secondary px-2.5 py-1 text-center text-[12.5px] font-bold tabular-nums">{pct(e.pct ?? 0)}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
