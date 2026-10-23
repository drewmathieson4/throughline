import { useSyncExternalStore } from "react";

// Tailwind's `md`, where the shell swaps the bottom tab bar for the sidebar. Most layout
// follows it in CSS; this is for the few places where the phone and the laptop do different
// things, not just look different (the phone's Record screen, a sheet versus a dialog).
const LAPTOP = "(min-width: 768px)";

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(LAPTOP);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

export function useIsLaptop() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(LAPTOP).matches);
}
