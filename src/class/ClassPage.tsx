import { useEffect, useState } from "react";
import type { MaterialRow } from "../../worker/api-types";
import { DOCUMENT_TYPES, api, fileInit, messageOf } from "../api";
import FilePicker from "../FilePicker";
import { dateFormat, errorText } from "../ui";
import { useAction } from "../useAction";
import { Button } from "@/components/ui/button";

// Class-level things: the course materials (syllabus, unit plan, grading policy) that tell
// the reports what the course is for and how grades are calculated. Upload is one click and
// the summary appears; delete is one click too.
export default function ClassPage({ classId }: { classId: string }) {
  const [materials, setMaterials] = useState<MaterialRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api<MaterialRow[]>(`/api/materials?classId=${classId}`)
      .then(setMaterials)
      .catch((e) => setLoadError(messageOf(e)));
  }, [classId]);

  const { run: upload, busy: uploading, error: uploadError } = useAction(async (file: File) => {
    const query = new URLSearchParams({ classId, name: file.name });
    const row = await api<MaterialRow>(`/api/materials?${query}`, fileInit(file));
    setMaterials((prev) => [row, ...(prev ?? [])]);
  });
  const { run: remove, busy: removing, error: removeError } = useAction(async (id: string) => {
    await api(`/api/materials/${id}`, { method: "DELETE" });
    setMaterials((prev) => prev?.filter((m) => m.id !== id) ?? null);
  });
  const error = loadError ?? uploadError ?? removeError;

  return (
    <section className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">Course materials</h2>
        <FilePicker accept={DOCUMENT_TYPES} disabled={uploading} onFile={upload}>
          {uploading ? "Reading…" : "Upload a syllabus or course document"}
        </FilePicker>
      </div>
      {error && <p className={`mt-2 ${errorText}`}>{error}</p>}
      {materials?.length === 0 && (
        <p className="mt-3 text-sm text-gray-500">No course materials yet. Upload the syllabus so reports can speak to the course's goals and grading.</p>
      )}
      <ul className="mt-2 divide-y divide-gray-200">
        {materials?.map((m) => (
          <li key={m.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{m.name}</span>
              <span className="text-xs text-gray-500">{dateFormat.format(new Date(m.createdAt))}</span>
              <Button type="button" variant="outline" size="sm" className="ml-auto" disabled={removing} onClick={() => remove(m.id)}>
                Delete
              </Button>
            </div>
            {m.summary ? <Summary summary={m.summary} /> : <p className="mt-1 text-xs text-gray-500">Stored, but the summary did not run.</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Summary({ summary }: { summary: NonNullable<MaterialRow["summary"]> }) {
  return (
    <div className="mt-1 text-sm">
      <p className="text-gray-700">{summary.description}</p>
      <Lines title="Grading" items={summary.grading.map((g) => `${g.category}: ${g.weight}%`)} />
      <Lines title="Goals" items={summary.goals} />
      <Lines title="Units" items={summary.units.map((u) => (u.when ? `${u.name} (${u.when})` : u.name))} />
      <Lines title="Policies" items={summary.policies} />
    </div>
  );
}

function Lines({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-gray-600">{title}</p>
      <ul className="ml-4 list-disc text-xs text-gray-700">
        {items.map((it) => (
          <li key={it}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
