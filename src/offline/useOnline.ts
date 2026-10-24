import { useSyncExternalStore } from "react";

// The browser's own idea of whether there is a connection. "Online" can still mean one bar
// that drops every request; the queue treats a failed fetch as offline too.
function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine);
