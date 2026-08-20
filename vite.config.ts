import { defineConfig } from "vite";
import { resolve } from "path";
import solidPlugin from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), solidPlugin()],
  server: {
    port: 3000
  },
  build: {
    rollupOptions: {
      // The agreement harness is a second entry point, not part of the editor bundle.
      input: {
        main: resolve(__dirname, "index.html"),
        agreement: resolve(__dirname, "agreement.html")
      }
    }
  }
});
