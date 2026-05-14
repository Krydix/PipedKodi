import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import Components from "unplugin-vue-components/vite";
import IconsResolver from "unplugin-icons/resolver";
import legacy from "@vitejs/plugin-legacy";
import VueI18nPlugin from "@intlify/unplugin-vue-i18n/vite";
import { VitePWA } from "vite-plugin-pwa";
import os from "node:os";
import path from "path";
import eslintPlugin from "vite-plugin-eslint";

const enableLegacyBuild = process.env.VITE_BUILD_LEGACY === "true";
const enableBuildLint = process.env.VITE_LINT_BUILD === "true";
const enableSourceMaps = process.env.VITE_BUILD_SOURCEMAP === "true";

function getAllowedHosts() {
    const detectedHostname = os.hostname().trim().toLowerCase();
    const normalizedHostname = detectedHostname.replace(/\.local$/u, "");
    const configuredHosts = (process.env.VITE_ALLOWED_HOSTS ?? "")
        .split(",")
        .map(host => host.trim().toLowerCase())
        .filter(Boolean);

    return Array.from(
        new Set([
            "localhost",
            ".local",
            detectedHostname,
            normalizedHostname,
            normalizedHostname ? `${normalizedHostname}.local` : "",
            ...configuredHosts,
        ].filter(Boolean)),
    );
}

const allowedHosts = getAllowedHosts();

// https://vitejs.dev/config/
export default defineConfig({
    server: {
        allowedHosts,
    },
    preview: {
        allowedHosts,
    },
    plugins: [
        vue(),
        tailwindcss(),
        Icons({ compiler: "vue3", scale: 1 }),
        Components({
            resolvers: [IconsResolver()],
            dts: false,
        }),
        VueI18nPlugin({
            include: path.resolve(__dirname, "./src/locales/**"),
        }),
        enableLegacyBuild
            ? legacy({
                  targets: ["defaults", "not IE 11"],
              })
            : null,
        VitePWA({
            registerType: "autoUpdate",
            workbox: {
                globPatterns: [
                    "**/*.{css,html}",
                    "**/[A-Z]*.js",
                    "**/index*.js",
                    "**/shaka-player*.js",
                    "manifest.webmanifest",
                ],
                globIgnores: ["**/*-legacy-*.js"],
                runtimeCaching: [
                    {
                        urlPattern: /https:\/\/[a-zA-Z./0-9_]*\.(?:otf|ttf)/i,
                        handler: "CacheFirst",
                        options: {
                            cacheName: "fonts-cache",
                            expiration: {
                                maxEntries: 10,
                                maxAgeSeconds: 60 * 60 * 24 * 365, // <== 365 days
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                ],
            },
            manifest: {
                name: "Piped",
                short_name: "Piped",
                background_color: "#000000",
                theme_color: "#fa4b4b",
                icons: [
                    { src: "./img/icons/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
                    { src: "./img/icons/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
                    {
                        src: "./img/icons/android-chrome-maskable-192x192.png",
                        sizes: "192x192",
                        type: "image/png",
                        purpose: "maskable",
                    },
                    {
                        src: "./img/icons/android-chrome-maskable-512x512.png",
                        sizes: "512x512",
                        type: "image/png",
                        purpose: "maskable",
                    },
                ],
            },
        }),
        enableBuildLint ? eslintPlugin() : null,
    ].filter(Boolean),
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    build: {
        sourcemap: enableSourceMaps,
        cssMinify: "lightningcss",
    },
});
