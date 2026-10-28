import type { ReactNode } from "react";
import type { SessionUser } from "../../worker/api-types";
import { DemoContext, useDemoStore } from "./demoStore";

export function DemoProvider({ user, children }: { user: SessionUser | null; children: ReactNode }) {
  return <DemoContext.Provider value={useDemoStore(user)}>{children}</DemoContext.Provider>;
}
