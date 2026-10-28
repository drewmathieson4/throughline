import type { ReactNode } from "react";
import type { SessionUser } from "../../worker/api-types";
import { AllowanceContext, useAllowanceStore } from "./allowanceStore";

export function AllowanceProvider({ user, children }: { user: SessionUser | null; children: ReactNode }) {
  return <AllowanceContext.Provider value={useAllowanceStore(user)}>{children}</AllowanceContext.Provider>;
}
