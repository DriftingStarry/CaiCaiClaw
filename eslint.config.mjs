import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
    {
        ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/*.tsbuildinfo"],
    },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        // harness/ 下的 node 脚本由 `node -` 直接执行，不经构建也不依赖 node_modules，因此使用 CJS。
        files: ["harness/**/*.cjs"],
        languageOptions: {
            sourceType: "commonjs",
            globals: {
                require: "readonly",
                module: "writable",
                process: "readonly",
                console: "readonly",
                __dirname: "readonly",
            },
        },
        rules: {
            "@typescript-eslint/no-require-imports": "off",
        },
    },
    {
        files: ["**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "./*.js",
                                "../*.js",
                                "./**/*.js",
                                "../**/*.js",
                                "./*.mjs",
                                "../*.mjs",
                                "./**/*.mjs",
                                "../**/*.mjs",
                                "./*.cjs",
                                "../*.cjs",
                                "./**/*.cjs",
                                "../**/*.cjs",
                            ],
                            message: "Use extensionless relative imports for local TypeScript modules.",
                        },
                    ],
                },
            ],
        },
    },
    eslintConfigPrettier,
);
