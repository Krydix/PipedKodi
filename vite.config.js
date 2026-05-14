import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import Components from "unplugin-vue-components/vite";
import IconsResolver from "unplugin-icons/resolver";
import legacy from "@vitejs/plugin-legacy";
import VueI18nPlugin from "@intlify/unplugin-vue-i18n/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import eslintPlugin from "vite-plugin-eslint";

const enableLegacyBuild = process.env.VITE_BUILD_LEGACY === "true";
const enableBuildLint = process.env.VITE_LINT_BUILD === "true";
const enableSourceMaps = process.env.VITE_BUILD_SOURCEMAP === "true";

// https://vitejs.dev/config/
export default defineConfig({
    server: {
        allowedHosts: true,
    },
    preview: {
        allowedHosts: true,
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
                globPatterns: ["**/*.{css,html}", "manifest.webmanifest"],
                // Locale and component JS chunks are fetched on demand; only precache the shell
                globIgnores: ["**/*.js", "**/*-legacy-*.js"],
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
        emptyOutDir: false,
        sourcemap: enableSourceMaps,
        cssMinify: "lightningcss",
    },
});
