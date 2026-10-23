// A student's grade summary, computed from their grade_entries rows. No model: the numbers
// are the evidence the student page shows and the synthesis will cite, so they have to be
// reproducible. The syllabus's weights are used when they cover every category the student
// has a score in; otherwise the overall is a plain mean and the page says so. Missing work
// is counted, not averaged: a zero would be a guess at the teacher's policy.
import type { CategorySummary, GradeEntryView, GradeSummary, GradeTrend, Standout } from "./api-types";
import type { GradeEntry } from "./db/schema";

export type Weight = { category: string; weight: number };

const TREND_MIN_ENTRIES = 4;
const TREND_THRESHOLD = 5; // percentage points between halves
const STANDOUT_GAP = 10; // percentage points from the student's own mean
const STANDOUT_MIN_CATEGORY_ENTRIES = 2;
const OTHER = "other";

const round = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

type Scored = GradeEntry & { pct: number | null };

const withPct = (e: GradeEntry): Scored => ({ ...e, pct: e.score !== null && e.maxScore > 0 ? (e.score / e.maxScore) * 100 : null });

// Due dates order the timeline when every entry has one; otherwise the file's column order
// does, which is how a grade book lays out a term anyway.
function timeline(entries: Scored[]): Scored[] {
  const dated = entries.every((e) => e.dueDate !== null);
  return [...entries].sort((a, b) => (dated ? a.dueDate!.localeCompare(b.dueDate!) || a.position - b.position : a.position - b.position));
}

function trendOf(ordered: Scored[]): GradeTrend | null {
  const pcts = ordered.flatMap((e) => (e.pct === null ? [] : [e.pct]));
  if (pcts.length < TREND_MIN_ENTRIES) return null;
  const half = Math.floor(pcts.length / 2);
  const from = Math.round(mean(pcts.slice(0, half)));
  const to = Math.round(mean(pcts.slice(half)));
  const label = to - from >= TREND_THRESHOLD ? "rising" : from - to >= TREND_THRESHOLD ? "slipping" : "steady";
  return { label, from, to };
}

function categories(entries: Scored[], weights: Weight[]): CategorySummary[] {
  const weightOf = new Map(weights.map((w) => [w.category.trim().toLowerCase(), w.weight]));
  const groups = new Map<string, { category: string; pcts: number[]; missing: number }>();
  for (const e of entries) {
    const category = e.category?.trim() || OTHER;
    const key = category.toLowerCase();
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { category, pcts: [], missing: 0 }));
    if (e.pct === null) g.missing++;
    else g.pcts.push(e.pct);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      category: g.category,
      weight: weightOf.get(key) ?? null,
      count: g.pcts.length,
      missing: g.missing,
      mean: g.pcts.length > 0 ? round(mean(g.pcts)) : null,
    }))
    .sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1));
}

// The scored entry furthest from the student's own mean on the given side, when the gap is
// worth a sentence, with the class mean on that assignment so a low score everyone got is
// shown as such.
function standout(entries: Scored[], own: number, side: "above" | "below", classEntries: Scored[]): Standout | null {
  let best: Scored | null = null;
  let gap = STANDOUT_GAP;
  for (const e of entries) {
    if (e.pct === null) continue;
    const d = side === "above" ? e.pct - own : own - e.pct;
    if (d > gap || (d === gap && !best)) {
      gap = d;
      best = e;
    }
  }
  if (!best) return null;
  const peers = classEntries.flatMap((e) => (e.assignment === best!.assignment && e.pct !== null ? [e.pct] : []));
  return { assignment: best.assignment, pct: round(best.pct!), classMean: peers.length > 0 ? round(mean(peers)) : null };
}

export function summarise(rows: GradeEntry[], classRows: GradeEntry[], weights: Weight[]): GradeSummary | null {
  if (rows.length === 0) return null;
  const entries = timeline(rows.map(withPct));
  const scored = entries.flatMap((e) => (e.pct === null ? [] : [e.pct]));
  const byCategory = categories(entries, weights);

  const withScores = byCategory.filter((c) => c.mean !== null);
  const weighted = scored.length > 0 && withScores.every((c) => c.weight !== null && c.weight > 0);
  const overall = weighted
    ? withScores.reduce((sum, c) => sum + c.mean! * c.weight!, 0) / withScores.reduce((sum, c) => sum + c.weight!, 0)
    : scored.length > 0
      ? mean(scored)
      : 0;

  const ranked = withScores.filter((c) => c.count >= STANDOUT_MIN_CATEGORY_ENTRIES);
  const strongest = ranked.length >= 2 ? ranked[0]!.category : null;
  const weakest = ranked.length >= 2 ? ranked[ranked.length - 1]!.category : null;

  const own = scored.length > 0 ? mean(scored) : 0;
  const classEntries = classRows.map(withPct);
  return {
    overall: round(overall),
    weighted,
    count: scored.length,
    missing: entries.length - scored.length,
    byCategory,
    strongest,
    weakest,
    trend: trendOf(entries),
    biggestWin: scored.length > 0 ? standout(entries, own, "above", classEntries) : null,
    biggestLoss: scored.length > 0 ? standout(entries, own, "below", classEntries) : null,
    entries: entries.map(
      (e): GradeEntryView => ({ assignment: e.assignment, category: e.category, score: e.score, maxScore: e.maxScore, pct: e.pct === null ? null : round(e.pct), dueDate: e.dueDate }),
    ),
  };
}
