import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(__dirname, "ui"),
  plugins: [react(), tailwindcss()],
  build: {
    assetsDir: "assets",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css") ? "assets/widget.css" : "assets/[name][extname]",
        entryFileNames: "assets/widget.js",
      },
    },
  },
});
