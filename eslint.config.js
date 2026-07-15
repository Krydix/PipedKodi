import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import vue from "eslint-plugin-vue";
import globals from "globals";

export default [
    { ignores: ["dist/**", "node_modules/**", ".local-data/**"] },
    {
        files: ["**/*.{js,mjs,vue}"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: { ...globals.browser, ...globals.node },
        },
    },
    js.configs.recommended,
    ...vue.configs["flat/recommended"],
    prettier,
];
