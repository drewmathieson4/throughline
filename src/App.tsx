import { useEffect, useState } from "react";
// Type-only imports: nothing from the Worker ends up in the browser bundle.
import type { ClassRow } from "../worker/db/schema";
import { api, jsonInit, messageOf } from "./api";
import ClassPage from "./class/ClassPage";
import NotesView from "./notes/NotesView";
import ReportsPage from "./reports/ReportsPage";
import StudentsPage from "./students/StudentsPage";
import { button, errorText, fieldLabel, input, subtleButton } from "./ui";
import { useAction } from "./useAction";

function NewClassForm({ onCreated, onCancel }: { onCreated: (c: ClassRow) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [termStart, setTermStart] = useState("");
  const [termEnd, setTermEnd] = useState("");
  const { run: submit, busy: saving, error } = useAction(async () => {
    onCreated(await api<ClassRow>("/api/classes", jsonInit("POST", { name, termStart: termStart || undefined, termEnd: termEnd || undefined })));
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-4 flex flex-wrap items-end gap-2 rounded border border-gray-200 p-3"
    >
      <label className={fieldLabel}>
        Class name
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className={fieldLabel}>
        Term start
        <input type="date" className={input} value={termStart} onChange={(e) => setTermStart(e.target.value)} />
      </label>
      <label className={fieldLabel}>
        Term end
        <input type="date" className={input} value={termEnd} onChange={(e) => setTermEnd(e.target.value)} />
      </label>
      <button type="submit" className={button} disabled={saving || !name.trim()}>
        {saving ? "Creating…" : "Create class"}
      </button>
      {onCancel && (
        <button type="button" className={subtleButton} onClick={onCancel}>
          Cancel
        </button>
      )}
      {error && <p className={`w-full ${errorText}`}>{error}</p>}
    </form>
  );
}

const views = [
  ["notes", "Notes"],
  ["students", "Students"],
  ["class", "Class"],
  ["reports", "Reports"],
] as const;
type View = (typeof views)[number][0];

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

function App() {
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [classId, setClassId] = useState<string | null>(readStoredClass);
  const [view, setView] = useState<View>("notes");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadClasses = () => api<ClassRow[]>("/api/classes").then(setClasses).catch((e) => setError(messageOf(e)));
  useEffect(() => {
    loadClasses();
  }, []);

  // classId is a preference (the teacher's pick, or the remembered one); the shown class is
  // derived from it so a remembered id that no longer exists falls back to the first class
  // wherever the list changes, not only in the fetch above.
  const cls = classes?.find((c) => c.id === classId) ?? classes?.[0] ?? null;
  const shownId = cls?.id;
  useEffect(() => {
    if (shownId) storeClass(shownId);
  }, [shownId]);

  function onClassCreated(c: ClassRow) {
    setClasses((prev) => [...(prev ?? []), c]);
    setClassId(c.id);
    setCreating(false);
    setView("students");
  }

  // With no class yet the form is the whole page and cannot be cancelled.
  const noClasses = classes?.length === 0;
  const hasClasses = !!classes?.length;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Throughline</h1>
        {hasClasses && (
          <div className="flex items-center gap-2">
            <select aria-label="Class" className={input} value={shownId ?? ""} onChange={(e) => setClassId(e.target.value)}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="button" className={subtleButton} onClick={() => setCreating(true)}>
              New class
            </button>
          </div>
        )}
      </header>
      <p className="mt-1 text-sm text-gray-500">
        {classes ? (cls?.name ?? "No class yet") : error ? "Classes unavailable" : "Loading…"} · synthetic demo, no real students
      </p>
      {error && <p className={`mt-4 ${errorText}`}>{error}</p>}

      {noClasses && <p className="mt-6 text-sm">Create your first class to start adding students and notes.</p>}
      {(noClasses || creating) && <NewClassForm onCreated={onClassCreated} onCancel={noClasses ? undefined : () => setCreating(false)} />}

      {cls && classes && (
        <>
          <nav className="mt-4 flex gap-1 border-b border-gray-200">
            {views.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`px-3 py-2 text-sm ${view === key ? "border-b-2 border-gray-900 font-medium" : "text-gray-500"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          {view === "notes" && <NotesView classes={classes} />}
          {view === "students" && <StudentsPage key={cls.id} classId={cls.id} onClassesChanged={loadClasses} />}
          {view === "class" && <ClassPage key={cls.id} classId={cls.id} />}
          {/* Hidden rather than unmounted so a Generate run survives a tab switch. */}
          <div hidden={view !== "reports"}>
            <ReportsPage key={cls.id} cls={cls} active={view === "reports"} />
          </div>
        </>
      )}
    </main>
  );
}

export default App;
