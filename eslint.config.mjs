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
