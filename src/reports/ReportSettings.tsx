import { useEffect, useRef, useState } from "react";
import type { ClassSettingsView, ReportRules } from "../../worker/api-types";
import { api, jsonInit, messageOf } from "../api";
import { errorText } from "../ui";
import { Panel } from "@/components/Panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// How this class's reports should read: a target length, phrases to keep out, a note to the
// writer, and pasted examples of the teacher's own past comments for the voice. Saved as
// typed, shortly after the last change and when the window closes; there is no Save button
// and nothing to confirm. The next report written reads them.

const SAVE_AFTER_MS = 800;

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
  const n = Number.parseInt(f.sentences, 10);
  if (Number.isInteger(n) && n >= 2 && n <= 12) rules.sentences = n;
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
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = `/api/classes/${classId}/settings`;

  useEffect(() => {
    if (!open) return;
    let latest = true;
    api<ClassSettingsView>(url)
      .then((s) => latest && setForm(toForm(s)))
      .catch((e) => latest && setError(messageOf(e)));
    return () => {
      latest = false;
    };
  }, [open, url]);

  function save(f: Form) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    api<ClassSettingsView>(url, jsonInit("PUT", toBody(f)))
      .then(() => {
        setSaved(true);
        setError(null);
      })
      .catch((e) => setError(messageOf(e)));
  }

  function change(patch: Partial<Form>) {
    if (!form) return;
    const next = { ...form, ...patch };
    setForm(next);
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), SAVE_AFTER_MS);
  }

  function close(next: boolean) {
    if (!next && form && timer.current) save(form);
    onOpenChange(next);
  }

  return (
    <Panel open={open} onOpenChange={close} title="Report settings" top>
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
