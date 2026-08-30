import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // 폐쇄망 배포는 서브 경로에 얹히는 경우가 많다. 절대 경로를 박지 않는다.
  base: "./",
  server: { port: 5173, open: false },
  build: { outDir: "dist", sourcemap: true, target: "es2022" },
});
