import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// react: JSX + fast refresh. tailwindcss: utility CSS. cloudflare: runs worker/index.ts
// locally inside `vite dev` with the same bindings (D1, etc.) it will have in production.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
});
