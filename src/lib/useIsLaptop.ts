import { useSyncExternalStore } from "react";

// Tailwind's `md`, where the shell swaps the bottom tab bar for the sidebar. Most layout
// follows it in CSS; this is for the few places where the phone and the laptop do different
// things, not just look different (the phone's Record screen, a sheet versus a dialog).
const LAPTOP = "(min-width: 768px)";

// One query for every caller, made on first use rather than at import.
let query: MediaQueryList | undefined;
const laptop = () => (query ??= window.matchMedia(LAPTOP));

const subscribe = (onChange: () => void) => {
  laptop().addEventListener("change", onChange);
  return () => laptop().removeEventListener("change", onChange);
};

export function useIsLaptop() {
  return useSyncExternalStore(subscribe, () => laptop().matches);
}
