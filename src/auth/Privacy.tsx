import type { ReactNode } from "react";
import { Link } from "react-router";
import { LogoWave, titleText } from "@/components/page";

// Where a teacher's data goes, for someone deciding whether to sign in: a static page that
// needs no session, linked from the sign-in screen, the account menu and Google's consent
// screen. Plain English, one short paragraph a section. Keep it in step with DECISIONS.md.
const UPDATED = "Updated 10 November 2026";
const RETENTION_URL = "https://platform.claude.com/docs/en/build-with-claude/api-and-data-retention";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[17px] font-extrabold tracking-[-0.01em]">{title}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-secondary-foreground">{children}</p>
    </section>
  );
}

export default function Privacy() {
  return (
    <>
      {/* The home-screen app draws under the iPhone status bar, whose text iOS makes white. */}
      <div aria-hidden className="fixed inset-x-0 top-0 z-40 h-(--statusbar-h) bg-primary md:hidden" />
      <main className="min-h-svh bg-background pt-[calc(var(--statusbar-h)+24px)] pb-[max(40px,env(safe-area-inset-bottom))] md:pt-10">
        <div className="mx-auto max-w-[640px] px-4 md:px-6">
          <Link to="/" className="inline-flex items-center gap-2.5">
            <span className="inline-flex size-9 items-center justify-center rounded-[11px] bg-primary text-primary-foreground">
              <LogoWave className="size-5" />
            </span>
            <span className="text-[19px] font-extrabold tracking-[-0.02em]">Throughline</span>
          </Link>
          <h1 className={`mt-8 ${titleText}`}>Privacy</h1>
          <p className="mt-1 text-[13px] font-semibold text-muted-foreground">{UPDATED}</p>
          <p className="mt-5 text-[15px] leading-relaxed text-secondary-foreground">
            Throughline keeps quick notes about your students and writes a throughline for each of them from those notes. This page says where that data goes.
          </p>

          <Section title="What is stored">
            Your classes and students, the notes you type or speak, the grades you import, the text of documents you import, the evidence Throughline writes for each student, the reports drafted from it, and the name and email on your Google account.
          </Section>
          <Section title="Where it lives">
            In a database at Cloudflare. A voice note is transcribed by Whisper on Cloudflare's hosted AI; the transcript is kept and the audio is not.
          </Section>
          <Section title="AI">
            To tag a note to the students it mentions, write the evidence and draft a report, the note text, quotes and grades are sent to Anthropic's API. Anthropic deletes what is sent to its API within 30 days and does not train on it; see{" "}
            <a href={RETENTION_URL} target="_blank" rel="noreferrer" className="font-semibold text-accent-foreground underline">
              Anthropic's data retention page
            </a>
            .
          </Section>
          <Section title="Google">
            Google is used to sign you in and tells Throughline your name, email and picture. No student data goes to Google.
          </Section>
          <Section title="Who can see it">
            Only you, in the app. Drew runs the service and can reach the database to fix a problem; he does not read notes otherwise.
          </Section>
          <Section title="Your data">
            You can delete a student, a class or your whole account from the app, and it is gone at once. You can export everything as a JSON file at any time from the account menu. Cloudflare keeps a point-in-time copy of the database for 30 days, which is the only way back from a mistaken delete.
          </Section>
          <Section title="Your school">
            Whether your school's rules allow real students here is your call to make before you add any. The hosted demo uses synthetic students only.
          </Section>
        </div>
      </main>
    </>
  );
}
