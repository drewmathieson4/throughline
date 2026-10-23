import type { GradeSummary, Standout } from "../../worker/api-types";
import { dateFormat } from "../ui";

const pct = (n: number) => `${Math.round(n)}%`;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// A due date is a calendar day; read it as local midnight so it shows as that day.
const day = (iso: string) => dateFormat.format(new Date(`${iso}T00:00:00`));

function StandoutLine({ label, s }: { label: string; s: Standout }) {
  return (
    <p>
      {label}: {s.assignment}, {pct(s.pct)}
      {s.classMean !== null && <span className="text-gray-500"> (class {pct(s.classMean)})</span>}.
    </p>
  );
}

// The grade summary computed in the Worker (worker/grades.ts): the headline numbers in a few
// sentences, then the scores in term order.
export default function Grades({ grades }: { grades: GradeSummary }) {
  const g = grades;
  const dated = g.entries.some((e) => e.dueDate);
  return (
    <section className="mt-6">
      <h3 className="text-sm font-medium text-gray-600">Grades</h3>
      <div className="mt-2 space-y-1 text-sm">
        <p>
          <span className="text-lg font-semibold">{g.count > 0 ? pct(g.overall) : "No scores yet"}</span>
          <span className="text-gray-500">
            {g.weighted && " · weighted as the syllabus says"} · {g.count} {g.count === 1 ? "score" : "scores"}
            {g.missing > 0 && <span className="text-amber-700">, {g.missing} missing</span>}
          </span>
        </p>
        {g.trend && (
          <p>
            {capitalise(g.trend.label)}: {pct(g.trend.from)} over the first half of the term, {pct(g.trend.to)} over the second.
          </p>
        )}
        {g.strongest && g.weakest && (
          <p>
            Strongest: {g.strongest} ({pct(g.byCategory.find((c) => c.category === g.strongest)!.mean!)}). Weakest: {g.weakest} (
            {pct(g.byCategory.find((c) => c.category === g.weakest)!.mean!)}).
          </p>
        )}
        {g.biggestWin && <StandoutLine label="Biggest win" s={g.biggestWin} />}
        {g.biggestLoss && <StandoutLine label="Biggest loss" s={g.biggestLoss} />}
      </div>
      <table className="mt-3 w-full text-sm">
        <thead className="text-left text-xs text-gray-500">
          <tr>
            <th className="py-1 font-medium">Assignment</th>
            <th className="py-1 font-medium">Category</th>
            <th className="py-1 font-medium">Score</th>
            {dated && <th className="py-1 font-medium">Due</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {g.entries.map((e) => (
            <tr key={e.assignment}>
              <td className="py-1.5">{e.assignment}</td>
              <td className="py-1.5 text-gray-600">{e.category ?? ""}</td>
              <td className="py-1.5">
                {e.score === null ? (
                  <span className="text-amber-700">missing</span>
                ) : (
                  <>
                    {e.score}/{e.maxScore} <span className="text-gray-500">· {pct(e.pct ?? 0)}</span>
                  </>
                )}
              </td>
              {dated && <td className="py-1.5 text-gray-600">{e.dueDate ? day(e.dueDate) : ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
