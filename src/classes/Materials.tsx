import { useState } from "react";
import { Check, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import type { MaterialRow } from "../../worker/api-types";
import { DOCUMENT_TYPES, api, fileInit } from "../api";
import FilePicker from "../FilePicker";
import { dateFormat, errorText } from "../ui";
import { useAction } from "../useAction";
import type { useMaterials } from "./useMaterials";
import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Class-level things: the course materials (syllabus, unit plan, grading policy) that tell
// the reports what the course is for and how grades are calculated. Upload is one pick and
// the summary appears; delete asks once, since only a fresh upload brings it back.
export default function Materials({ classId, materials, setMaterials, error: loadError }: { classId: string } & ReturnType<typeof useMaterials>) {
  const [deleting, setDeleting] = useState<MaterialRow | null>(null);
  const { run: upload, busy: uploading, error: uploadError } = useAction(async (file: File) => {
    const query = new URLSearchParams({ classId, name: file.name });
    const row = await api<MaterialRow>(`/api/materials?${query}`, fileInit(file));
    setMaterials((prev) => [row, ...(prev ?? [])]);
    toast.success(row.summary ? `Read ${row.name}` : `Stored ${row.name}; the summary did not run`);
  });
  const { run: remove, busy: removing, error: removeError } = useAction(async (m: MaterialRow) => {
    await api(`/api/materials/${m.id}`, { method: "DELETE" });
    setMaterials((prev) => prev?.filter((x) => x.id !== m.id) ?? null);
    toast(`Deleted ${m.name}`);
  });
  const error = loadError ?? uploadError ?? removeError;

  return (
    <div className="mt-4 flex flex-col gap-3.5">
      <FilePicker
        accept={DOCUMENT_TYPES}
        disabled={uploading}
        onFile={upload}
        className="h-auto w-full justify-start gap-3.5 rounded-[22px] border-2 border-dashed border-[#C9D0DC] bg-transparent px-[18px] py-4 text-left whitespace-normal text-foreground hover:bg-accent/40"
      >
        <span className="inline-flex size-11 flex-none items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Upload className="size-5" aria-hidden />
        </span>
        <span>
          <span className="block text-[15px] font-bold">{uploading ? "Reading…" : "Upload a syllabus or course document"}</span>
          <span className="mt-0.5 block text-[13px] font-normal text-muted-foreground">Reports use its goals and grading weights</span>
        </span>
      </FilePicker>
      {error && <p className={errorText}>{error}</p>}
      {materials?.map((m) => (
        <article key={m.id} className="rounded-[22px] border border-border bg-card p-[18px]">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 flex-none items-center justify-center rounded-xl bg-sky text-sky-foreground">
              <FileText className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-bold [overflow-wrap:anywhere]">{m.name}</h3>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">Added {dateFormat.format(new Date(m.createdAt))}</p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={removing} onClick={() => setDeleting(m)}>
              Delete
            </Button>
          </div>
          {m.summary ? <Summary summary={m.summary} /> : <p className="mt-3 text-sm text-muted-foreground">Stored, but the summary did not run.</p>}
        </article>
      ))}
      {materials?.length === 0 && (
        <p className="mt-1 text-center text-sm text-muted-foreground">No course materials yet. Upload the syllabus so reports can speak to the course's goals and grading.</p>
      )}

      <Panel open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)} title={`Delete ${deleting?.name ?? ""}?`}>
        <p className="mt-2 text-sm text-secondary-foreground">Reports stop using its goals and grading weights. Upload it again to bring it back.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={removing}
            onClick={async () => {
              if (deleting && (await remove(deleting))) setDeleting(null);
            }}
          >
            {removing ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

// The grading bar's colours, in category order; the legend carries the names and numbers.
const BAR = ["bg-primary", "bg-mint-dot", "bg-sunny-dot", "bg-coral-dot", "bg-sky-foreground", "bg-accent-foreground"];
const caption = "mb-2 text-xs font-extrabold tracking-[.06em] text-muted-foreground uppercase";

function Summary({ summary }: { summary: NonNullable<MaterialRow["summary"]> }) {
  return (
    <>
      <p className="mt-3.5 text-[14.5px] leading-relaxed text-secondary-foreground">{summary.description}</p>
      {summary.grading.some((g) => g.weight > 0) && (
        <section className="mt-[18px]">
          <h4 className={caption}>Grading</h4>
          <div aria-hidden className="flex h-3.5 gap-[3px] overflow-hidden rounded-full">
            {summary.grading.map((g, i) => (
              <span key={g.category} className={cn("basis-0", BAR[i % BAR.length])} style={{ flexGrow: g.weight }} />
            ))}
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-2">
            {summary.grading.map((g, i) => (
              <li key={g.category} className="inline-flex items-center gap-1.5 text-[13px] text-secondary-foreground">
                <span aria-hidden className={cn("size-2.5 rounded-[3px]", BAR[i % BAR.length])} />
                {g.category} <span className="font-bold">{g.weight}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {summary.goals.length > 0 && (
        <section className="mt-5">
          <h4 className={caption}>Goals</h4>
          <ul className="flex flex-col gap-2">
            {summary.goals.map((goal) => (
              <li key={goal} className="flex gap-2.5 text-sm leading-normal">
                <span aria-hidden className="mt-px inline-flex size-5 flex-none items-center justify-center rounded-full bg-mint text-mint-foreground">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                {goal}
              </li>
            ))}
          </ul>
        </section>
      )}
      {summary.units.length > 0 && (
        <section className="mt-5">
          <h4 className={caption}>Units</h4>
          <ul className="flex flex-wrap gap-2">
            {summary.units.map((u) => (
              <li key={u.name} className="rounded-xl bg-secondary px-3 py-1.5 text-[13px] text-secondary-foreground">
                <span className="font-bold">{u.name}</span>
                {u.when && ` · ${u.when}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {summary.policies.length > 0 && (
        <section className="mt-5">
          <h4 className={caption}>Policies</h4>
          <ul className="ml-[18px] list-disc text-sm leading-[1.7] text-secondary-foreground">
            {summary.policies.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
