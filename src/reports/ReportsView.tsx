import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import type { ClassRow } from "../../worker/db/schema";
import type { SynthesisRosterRow } from "../../worker/api-types";
import { api, messageOf } from "../api";
import { useNotes } from "../notes/notesStore";
import { errorText } from "../ui";
import ReportPane from "./ReportPane";
import ReportRoster from "./ReportRoster";
import ReportsControls from "./ReportsControls";
import { needsRun, runBusy, sameRange, useReports, validRange, type Range } from "./reportsStore";
import { BackLink, PageTitle } from "@/components/page";
import { useIsLaptop } from "@/lib/useIsLaptop";
import { cn } from "@/lib/utils";

// Reports: pick a class and a period, see which students have a summary for it and whether
// it is still current, make the ones that are missing or out of date, and read one. Each
// summary is an Opus call, so Generate only appears where the evidence has changed.
// Laptop: the roster and the open report side by side. Phone: the roster, then the report
// on its own screen.

const STORED_CLASS_KEY = "throughline.classId";
// Storage can be blocked (private mode, embedded pages); remembering the class is a nicety, not a need.
const readStoredClass = () => {
  try {
    return localStorage.getItem(STORED_CLASS_KEY);
  } catch {
    return null;
  }
};
const storeClass = (id: string) => {
  try {
    localStorage.setItem(STORED_CLASS_KEY, id);
  } catch {
    /* ignore */
  }
};

export default function ReportsView({ classes }: { classes: ClassRow[] }) {
  const { classId, studentId } = useParams();
  if (classes.length === 0) {
    return (
      <section>
        <PageTitle>Reports</PageTitle>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Reports are made per class.{" "}
          <Link to="/classes" className="font-bold text-accent-foreground hover:underline">
            Create a class
          </Link>{" "}
          to start.
        </p>
      </section>
    );
  }
  // /reports goes back to the last class picked; a class that no longer exists goes there too.
  const cls = classes.find((c) => c.id === classId);
  if (!cls) {
    const stored = readStoredClass();
    const pick = classes.find((c) => c.id === stored) ?? classes[0];
    return <Navigate to={`/reports/${pick.id}`} replace />;
  }
  return <ClassReports key={cls.id} classes={classes} cls={cls} studentId={studentId} />;
}

function ClassReports({ classes, cls, studentId }: { classes: ClassRow[]; cls: ClassRow; studentId: string | undefined }) {
  const reports = useReports();
  const { colourOf } = useNotes();
  const isLaptop = useIsLaptop();
  const navigate = useNavigate();
  const range = reports.rangeOf(cls);
  const { from, to } = range;
  const valid = validRange(range);
  // The roster with the range it was loaded for. Generating uses that range, not the date
  // boxes, so the students queued and the period they are generated for always match.
  const [roster, setRoster] = useState<{ range: Range; rows: SynthesisRosterRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    storeClass(cls.id);
  }, [cls.id]);

  // Refetched after every finished summary or recorded answer (the store's version).
  useEffect(() => {
    if (!valid) return;
    // Typing a date fires a fetch per keystroke; only the newest may land.
    let latest = true;
    api<SynthesisRosterRow[]>(`/api/syntheses?${new URLSearchParams({ classId: cls.id, from, to })}`)
      .then((rows) => {
        if (!latest) return;
        setRoster({ range: { from, to }, rows });
        setError(null);
      })
      .catch((e) => latest && setError(messageOf(e)));
    return () => {
      latest = false;
    };
  }, [cls.id, from, to, valid, reports.version]);

  const rows = roster?.rows ?? null;
  // Between a date change and its roster arriving, the roster shows the old range.
  const ready = roster !== null && sameRange(roster.range, range);
  const run = reports.runOf(cls.id);
  const busy = runBusy(run);
  const colour = colourOf(cls.id);
  // A laptop with no student picked shows the first.
  const selectedId = studentId ?? (isLaptop ? rows?.[0]?.studentId : undefined);
  const selected = rows?.find((r) => r.studentId === selectedId) ?? null;

  // A student who is not on this roster (they left, or the link is old): back to the class.
  if (studentId && rows && !selected) return <Navigate to={`/reports/${cls.id}`} replace />;

  // A single student: open their report and make it there.
  async function generateOne(id: string, period: Range) {
    setError(null);
    if (id !== studentId) navigate(`/reports/${cls.id}/${id}`);
    try {
      await reports.generate(id, period);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  function generateClass() {
    if (!roster) return;
    setError(null);
    reports.generateClass(
      cls.id,
      roster.range,
      roster.rows.filter(needsRun).map((r) => r.studentId),
    );
  }

  const pane = selected && roster && (
    <ReportPane
      key={selected.studentId}
      row={selected}
      range={roster.range}
      classId={cls.id}
      colour={colour}
      running={reports.running.has(selected.studentId)}
      disabled={busy || !ready}
      onGenerate={(period) => generateOne(selected.studentId, period)}
      onRecorded={reports.refresh}
    />
  );
  const errorLine = error && <p className={cn("mt-3", errorText)}>{error}</p>;

  // Phone, one student: the report on its own, with the way back to the list.
  if (!isLaptop && studentId) {
    return (
      <section>
        <BackLink to={`/reports/${cls.id}`}>Reports</BackLink>
        {errorLine}
        <div className="mt-2">{pane ?? <p className="text-sm text-muted-foreground">Loading…</p>}</div>
      </section>
    );
  }

  return (
    <section>
      <ReportsControls
        classes={classes}
        cls={cls}
        range={range}
        onRange={(r) => reports.setRange(cls.id, r)}
        pending={(rows ?? []).filter(needsRun).length}
        ready={ready}
        run={run}
        onGenerateClass={generateClass}
      />
      {errorLine}
      {/* Side by side from lg; a narrow laptop window stacks them. */}
      <div className="mt-[18px] flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex-none lg:sticky lg:top-6 lg:w-[320px]">
          {rows ? (
            <ReportRoster
              rows={rows}
              classId={cls.id}
              colour={colour}
              selectedId={isLaptop ? selectedId : undefined}
              running={reports.running}
              disabled={busy || !ready}
              onGenerate={(id) => roster && generateOne(id, roster.range)}
            />
          ) : (
            !error && <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </div>
        {isLaptop && <div className="min-w-0 flex-1">{pane}</div>}
      </div>
    </section>
  );
}
