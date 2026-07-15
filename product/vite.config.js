import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [vue()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    build: { outDir: "dist", emptyOutDir: true },
    server: {
        port: 4174,
        proxy: {
            "/api": { target: "http://127.0.0.1:8095", ws: true },
        },
    },
});
