import type { CSSProperties } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// Written by hand rather than added with the shadcn CLI: its version pulls in next-themes to
// follow dark mode, which this app does not have. Dark toasts on the white app, bottom right
// on a laptop and above the tab bar on a phone.
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      offset={28}
      mobileOffset={{ bottom: 92, left: 16, right: 16 }}
      duration={3200}
      style={
        {
          "--normal-bg": "var(--foreground)",
          "--normal-text": "var(--background)",
          "--normal-border": "transparent",
          "--border-radius": "16px",
        } as CSSProperties
      }
      toastOptions={{ classNames: { toast: "font-sans font-semibold shadow-toast" } }}
      {...props}
    />
  )
}

export { Toaster }
