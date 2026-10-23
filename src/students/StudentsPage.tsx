import { useEffect, useState } from "react";
import type { Student } from "../../worker/db/schema";
import type { RosterStudent, StudentDetail as StudentDetailResponse } from "../../worker/api-types";
import { api, jsonInit, messageOf } from "../api";
import NoteItem from "../NoteItem";
import Grades from "./Grades";
import ImportGrades from "./ImportGrades";
import ImportRoster from "./ImportRoster";
import { button, dateFormat, errorText, fieldLabel, input, subtleButton } from "../ui";
import { useAction } from "../useAction";

// Local calendar date as YYYY-MM-DD, built from the parts rather than a locale format so the
// server's date check cannot trip on an ICU quirk. Local, not UTC: a teacher marking a
// student as left at 7pm should get today.
function today() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// How long since a student was last written about: green within a week, amber within a
// month, red older or never. Scannable, so the quiet students stand out.
function freshness(at: Date | null) {
  if (!at) return { dot: "bg-red-500", label: "no notes yet" };
  const days = (Date.now() - at.getTime()) / DAY_MS;
  if (days <= 7) return { dot: "bg-green-500", label: "within the last week" };
  if (days <= 30) return { dot: "bg-amber-400", label: "within the last month" };
  return { dot: "bg-red-500", label: "over a month ago" };
}

function LastNote({ at }: { at: string | null }) {
  const date = at ? new Date(at) : null;
  const { dot, label } = freshness(date);
  return (
    <span className="flex items-center gap-1.5" title={`Last note: ${label}`}>
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {date ? dateFormat.format(date) : "never"}
    </span>
  );
}

function AddStudentForm({ classId, onAdded }: { classId: string; onAdded: () => void }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const { run: submit, busy: saving, error } = useAction(async () => {
    await api("/api/students", jsonInit("POST", { classId, firstName: first, lastName: last }));
    onAdded();
    setFirst("");
    setLast("");
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-4 flex flex-wrap items-end gap-2"
    >
      <label className={fieldLabel}>
        First name
        <input className={input} value={first} onChange={(e) => setFirst(e.target.value)} />
      </label>
      <label className={fieldLabel}>
        Last name
        <input className={input} value={last} onChange={(e) => setLast(e.target.value)} />
      </label>
      <button type="submit" className={button} disabled={saving || !first.trim() || !last.trim()}>
        {saving ? "Adding…" : "Add student"}
      </button>
      {error && <p className={`w-full ${errorText}`}>{error}</p>}
    </form>
  );
}

function StudentDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<StudentDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Non-null while the name is being edited.
  const [draft, setDraft] = useState<{ first: string; last: string } | null>(null);
  const { run: patch, busy, error } = useAction(async (body: Partial<Pick<Student, "firstName" | "lastName" | "leftAt">>) => {
    const student = await api<Student>(`/api/students/${id}`, jsonInit("PATCH", body));
    setData((prev) => prev && { ...prev, student });
  });

  useEffect(() => {
    api<StudentDetailResponse>(`/api/students/${id}`)
      .then(setData)
      .catch((e) => setLoadError(messageOf(e)));
  }, [id]);

  const back = (
    <button type="button" onClick={onBack} className="text-sm text-gray-500 hover:underline">
      ← All students
    </button>
  );

  // Keep the way back even when the load fails (student deleted elsewhere, network down).
  if (!data) {
    return (
      <section className="mt-4">
        {back}
        <p className={`mt-2 ${loadError ? errorText : "text-sm text-gray-500"}`}>{loadError ?? "Loading…"}</p>
      </section>
    );
  }

  const { student, notes, grades } = data;
  return (
    <section className="mt-4">
      {back}
      {draft ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            // Only a saved rename closes the form; a failure keeps the typed text on screen.
            if (await patch({ firstName: draft.first, lastName: draft.last })) setDraft(null);
          }}
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          <input className={input} value={draft.first} onChange={(e) => setDraft({ ...draft, first: e.target.value })} aria-label="First name" />
          <input className={input} value={draft.last} onChange={(e) => setDraft({ ...draft, last: e.target.value })} aria-label="Last name" />
          <button type="submit" className={button} disabled={busy || !draft.first.trim() || !draft.last.trim()}>
            Save
          </button>
          <button type="button" className={subtleButton} onClick={() => setDraft(null)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">
            {student.firstName} {student.lastName}
          </h2>
          {student.leftAt && <span className="rounded bg-gray-200 px-2 py-0.5 text-xs">left {student.leftAt}</span>}
          <button type="button" className={subtleButton} disabled={busy} onClick={() => setDraft({ first: student.firstName, last: student.lastName })}>
            Edit name
          </button>
          {student.leftAt ? (
            <button type="button" className={subtleButton} disabled={busy} onClick={() => patch({ leftAt: null })}>
              Reactivate
            </button>
          ) : (
            <button type="button" className={subtleButton} disabled={busy} onClick={() => patch({ leftAt: today() })}>
              Mark as left
            </button>
          )}
        </div>
      )}
      {error && <p className={`mt-2 ${errorText}`}>{error}</p>}

      {grades && <Grades grades={grades} />}

      <h3 className="mt-6 text-sm font-medium text-gray-600">Notes tagged to {student.firstName}</h3>
      <ul className="mt-2 divide-y divide-gray-200">
        {notes.map((n) => (
          <NoteItem key={n.id} note={n} />
        ))}
        {notes.length === 0 && <li className="py-3 text-sm text-gray-500">No notes tagged to this student yet.</li>}
      </ul>
    </section>
  );
}

// onClassesChanged: an import can create classes, which the picker in App needs to know about.
export default function StudentsPage({ classId, onClassesChanged }: { classId: string; onClassesChanged: () => void }) {
  // The full roster, departed students included; the checkbox filters it here so toggling
  // costs no request.
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [includeLeft, setIncludeLeft] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after an add or on the way back from a detail page (which may have renamed or
  // marked someone as left), so the effect below refetches the server-sorted list.
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  useEffect(() => {
    api<RosterStudent[]>(`/api/students?classId=${classId}`)
      .then((rows) => {
        setStudents(rows);
        setError(null);
      })
      .catch((e) => setError(messageOf(e)));
  }, [classId, version]);

  if (selected) {
    return (
      <StudentDetail
        id={selected}
        onBack={() => {
          setSelected(null);
          refresh();
        }}
      />
    );
  }

  const shown = includeLeft ? students : students.filter((s) => !s.leftAt);
  return (
    <section>
      <div className="mt-4 flex items-center justify-between">
        <h2 className="text-lg font-medium">
          Students <span className="text-sm font-normal text-gray-500">({shown.length})</span>
        </h2>
        <label className="flex items-center gap-1 text-sm text-gray-600">
          <input type="checkbox" checked={includeLeft} onChange={(e) => setIncludeLeft(e.target.checked)} />
          Show students who left
        </label>
      </div>
      {error && <p className={`mt-2 ${errorText}`}>{error}</p>}
      <table className="mt-2 w-full text-sm">
        <thead className="text-left text-xs text-gray-500">
          <tr>
            <th className="py-1 font-medium">Name</th>
            <th className="py-1 font-medium">Notes</th>
            <th className="py-1 font-medium">Last note</th>
            <th className="py-1 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {shown.map((s) => (
            <tr key={s.id} className="hover:bg-gray-50">
              <td className="py-2">
                <button type="button" onClick={() => setSelected(s.id)} className="text-left hover:underline">
                  {s.lastName}, {s.firstName}
                </button>
              </td>
              <td className="py-2">
                {s.noteCount}
                {s.unsureCount > 0 && <span className="text-amber-700"> · {s.unsureCount} unsure</span>}
              </td>
              <td className="py-2">
                <LastNote at={s.lastNotedAt} />
              </td>
              <td className="py-2 text-gray-500">{s.leftAt ? `left ${s.leftAt}` : ""}</td>
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-gray-500">
                {students.length === 0
                  ? "No students yet. Add one below."
                  : `All ${students.length} students have left. Tick the box above to show them.`}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <AddStudentForm classId={classId} onAdded={refresh} />
      <ImportRoster
        classId={classId}
        onImported={(result) => {
          refresh();
          if (result.classes.some((k) => k.created)) onClassesChanged();
        }}
      />
      <ImportGrades classId={classId} />
    </section>
  );
}
