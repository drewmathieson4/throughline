import { useEffect, useState } from "react";
import type { ClassSettingsView, ReportRules } from "../../worker/api-types";
import { api, jsonInit, messageOf } from "../api";
import { errorText } from "../ui";
import { useAutosave } from "../useAutosave";
import { Panel } from "@/components/Panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// How this class's reports should read: a target length, phrases to keep out, a note to the
// writer, and pasted examples of the teacher's own past comments for the voice. Saved as
// typed, shortly after the last change and when the window closes; there is no Save button
// and nothing to confirm. The next report written reads them.

type Form = { sentences: string; avoid: string; notes: string; samples: string };

const toForm = (s: ClassSettingsView): Form => ({
  sentences: s.reportRules?.sentences ? String(s.reportRules.sentences) : "",
  avoid: (s.reportRules?.avoid ?? []).join("\n"),
  notes: s.reportRules?.notes ?? "",
  samples: s.styleSamples ?? "",
});

// The form as the route takes it: blank fields left out, so an untouched form stores nothing.
function toBody(f: Form): ClassSettingsView {
  const rules: ReportRules = {};
  // Sent as typed; the route's bounds are the only ones, and a 400 shows in the status line.
  if (f.sentences.trim()) rules.sentences = Number(f.sentences);
  const avoid = f.avoid
    .split("\n")
    .map((a) => a.trim())
    .filter(Boolean);
  if (avoid.length) rules.avoid = avoid;
  if (f.notes.trim()) rules.notes = f.notes.trim();
  return { reportRules: Object.keys(rules).length ? rules : null, styleSamples: f.samples.trim() || null };
}

export default function ReportSettings({ classId, open, onOpenChange }: { classId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const url = `/api/classes/${classId}/settings`;
  // Keyed by the open window: closing it saves what is waiting.
  const { saved, error: saveError, edit } = useAutosave<Form>(open ? url : null, (f, to) => api<ClassSettingsView>(to, jsonInit("PUT", toBody(f))));
  const error = loadError ?? saveError;

  useEffect(() => {
    if (!open) return;
    let latest = true;
    api<ClassSettingsView>(url)
      .then((s) => latest && setForm(toForm(s)))
      .catch((e) => latest && setLoadError(messageOf(e)));
    return () => {
      latest = false;
    };
  }, [open, url]);

  function change(patch: Partial<Form>) {
    if (!form) return;
    const next = { ...form, ...patch };
    setForm(next);
    edit(next);
  }

  return (
    <Panel open={open} onOpenChange={onOpenChange} title="Report settings" top>
      {form ? (
        <div className="mt-3 flex flex-col gap-4 overflow-y-auto">
          <Label>
            Sentences per report
            <Input type="number" inputMode="numeric" min={2} max={12} placeholder="4 to 6" className="w-28" value={form.sentences} onChange={(e) => change({ sentences: e.target.value })} />
          </Label>
          <Label>
            Phrases to keep out, one per line
            <Textarea rows={3} placeholder={"always\nnever"} value={form.avoid} onChange={(e) => change({ avoid: e.target.value })} />
          </Label>
          <Label>
            Anything else the writer should know
            <Textarea rows={3} placeholder="Mention the field trip. Keep it light on grades." value={form.notes} onChange={(e) => change({ notes: e.target.value })} />
          </Label>
          <Label>
            Comments you have written before
            <Textarea rows={6} placeholder="Paste a few past comments. The report copies the voice, not the facts." value={form.samples} onChange={(e) => change({ samples: e.target.value })} />
          </Label>
          <p className={cn("text-xs", error ? errorText : "text-muted-foreground")}>{error ?? (saved ? "Saved. The next report written uses these." : "Saving…")}</p>
        </div>
      ) : (
        <p className={cn("mt-3", error ? errorText : "text-sm text-muted-foreground")}>{error ?? "Loading…"}</p>
      )}
    </Panel>
  );
}
