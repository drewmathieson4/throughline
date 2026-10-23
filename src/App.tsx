import { useEffect, useState } from "react";
import { MessageSquareText, Sparkles, Users, type LucideIcon } from "lucide-react";
import { Link, NavLink, Navigate, Route, Routes, useMatch } from "react-router";
// Type-only imports: nothing from the Worker ends up in the browser bundle.
import type { ClassRow } from "../worker/db/schema";
import { api, messageOf } from "./api";
import ClassesPage from "./classes/ClassesPage";
import ClassView, { StudentView } from "./classes/ClassView";
import NotesView from "./notes/NotesView";
import ReportsPage from "./reports/ReportsPage";
import { errorText } from "./ui";
import { Avatar } from "@/components/Avatar";
import { PageTitle } from "@/components/page";
import { cn } from "@/lib/utils";

const tabs: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/notes", label: "Notes", icon: MessageSquareText },
  { to: "/classes", label: "Classes", icon: Users },
  { to: "/reports", label: "Reports", icon: Sparkles },
];

const DEMO_NOTICE = "Demo with synthetic students. No real student data.";

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

function Wordmark() {
  return (
    <Link to="/notes" className="flex items-center gap-2.5 px-2.5 pb-[26px]">
      <span className="inline-flex size-9 items-center justify-center rounded-[11px] bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 15c3 0 3-6 6-6s3 6 6 6 3-6 6-6" />
        </svg>
      </span>
      <span className="text-[19px] font-extrabold tracking-[-0.02em]">Throughline</span>
    </Link>
  );
}

// Laptop: a slim sidebar. Phone: the same three tabs as a bar along the bottom.
function SideNav() {
  return (
    <nav aria-label="Main" className="sticky top-0 hidden h-svh w-62 flex-none flex-col gap-1 border-r border-border px-4 pt-7 pb-5 md:flex">
      <Wordmark />
      {tabs.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn("flex min-h-[46px] items-center gap-3 rounded-[14px] px-3 text-[15px]", isActive ? "bg-accent font-bold text-accent-foreground" : "font-semibold text-secondary-foreground hover:bg-muted")
          }
        >
          <Icon className="size-5" aria-hidden />
          {label}
        </NavLink>
      ))}
      <p className="mt-auto rounded-[14px] bg-muted px-3.5 py-3 text-[12.5px] leading-normal text-muted-foreground">{DEMO_NOTICE}</p>
    </nav>
  );
}

function TabBar() {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-border bg-background px-2 pt-1.5 pb-[max(20px,env(safe-area-inset-bottom))] md:hidden">
      {tabs.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => cn("flex min-h-[52px] flex-1 flex-col items-center gap-[3px] pt-1 text-xs", isActive ? "font-extrabold text-accent-foreground" : "font-semibold text-muted-foreground")}>
          {({ isActive }) => (
            <>
              <span className={cn("inline-flex h-8 w-15 items-center justify-center rounded-full", isActive && "bg-accent")}>
                <Icon className="size-5" aria-hidden />
              </span>
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

// The only class switcher in the app: notes are not filed by class, and Classes picks a class
// by its card.
function ReportsHeader({ classes, current }: { classes: ClassRow[]; current: string }) {
  return (
    <>
      <PageTitle eyebrow="The brief for each student's report, built from your notes and grades">Reports</PageTitle>
      <nav aria-label="Class" className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] md:mx-0 md:mt-[22px] md:flex-wrap md:px-0">
        {classes.map((c) => (
          <Link
            key={c.id}
            to={`/reports/${c.id}`}
            aria-current={c.id === current ? "page" : undefined}
            className={cn(
              "inline-flex min-h-[42px] flex-none items-center gap-2 rounded-full border pr-4 pl-1.5 text-sm font-bold",
              c.id === current ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-secondary-foreground hover:bg-muted",
            )}
          >
            <Avatar id={c.id} name={c.name} size="sm" className="size-[30px] text-[10.5px]" />
            {c.name}
          </Link>
        ))}
      </nav>
    </>
  );
}

function App() {
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadClasses = () => api<ClassRow[]>("/api/classes").then(setClasses).catch((e) => setError(messageOf(e)));
  useEffect(() => {
    loadClasses();
  }, []);

  // The class Reports shows. It is kept here as well as in the URL because the Reports page
  // stays mounted while another tab shows (so a class run keeps going), and because /reports
  // goes back to the last class picked. A URL naming a class that no longer exists is
  // never adopted; the route below sends it on to this one.
  const onReports = useMatch("/reports/*") !== null;
  const urlReportsId = useMatch("/reports/:classId")?.params.classId;
  const [reportsId, setReportsId] = useState(readStoredClass);
  if (urlReportsId && urlReportsId !== reportsId && classes?.some((c) => c.id === urlReportsId)) setReportsId(urlReportsId);
  const reportsCls = classes?.find((c) => c.id === reportsId) ?? classes?.[0] ?? null;
  const shownReportsId = reportsCls?.id;
  useEffect(() => {
    if (shownReportsId) storeClass(shownReportsId);
  }, [shownReportsId]);
  const unknownReportsUrl = !!urlReportsId && !!classes && !classes.some((c) => c.id === urlReportsId);

  return (
    <div className="min-h-svh md:flex">
      <SideNav />
      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        <div className={cn("mx-auto px-4 pt-[18px] pb-7 md:px-12 md:pt-10 md:pb-[72px]", onReports ? "max-w-[1160px]" : "max-w-[780px]")}>
          {error && <p className={`mb-4 ${errorText}`}>{error}</p>}
          {classes === null ? (
            !error && <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Routes>
              <Route path="/" element={<Navigate to="/notes" replace />} />
              <Route path="/notes" element={<NotesView classes={classes} />} />
              <Route path="/classes" element={<ClassesPage classes={classes} onCreated={(c) => setClasses((prev) => [...(prev ?? []), c])} />} />
              <Route path="/classes/:classId" element={<ClassView classes={classes} onClassesChanged={loadClasses} />} />
              <Route path="/classes/:classId/students/:studentId" element={<StudentView classes={classes} />} />
              {/* The Reports page itself renders below, outside the routes, so it stays mounted. */}
              <Route path="/reports" element={reportsCls && <Navigate to={`/reports/${reportsCls.id}`} replace />} />
              <Route path="/reports/:classId" element={unknownReportsUrl && <Navigate to="/reports" replace />} />
              <Route path="*" element={<Navigate to="/notes" replace />} />
            </Routes>
          )}

          {reportsCls && classes && (
            <div hidden={!onReports}>
              <ReportsHeader classes={classes} current={reportsCls.id} />
              <ReportsPage key={reportsCls.id} cls={reportsCls} active={onReports} />
            </div>
          )}
          {onReports && classes?.length === 0 && (
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
          )}

          <p className="mt-10 text-center text-xs text-muted-foreground md:hidden">{DEMO_NOTICE}</p>
        </div>
      </main>
      <TabBar />
    </div>
  );
}

export default App;
