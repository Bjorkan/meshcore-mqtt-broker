import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "build/**",
      "*.zip",
      "*.tar",
    ],
  },

  js.configs.recommended,

  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ...config,
  })),

  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.es2020,
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-control-regex": "off",

      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    files: ["src/**/*.tsx"],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },

  {
    files: ["src/**/*.tsx"],
    ...react.configs.flat["jsx-runtime"],
  },

  {
    files: ["src/**/*.tsx"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Lite extra “håll React-koden snygg”-regler.
      "react/boolean-prop-naming": "warn",
      "react/button-has-type": "error",
      "react/destructuring-assignment": ["warn", "always"],
      "react/function-component-definition": [
        "warn",
        {
          namedComponents: "function-declaration",
          unnamedComponents: "arrow-function",
        },
      ],
      "react/jsx-boolean-value": ["warn", "never"],
      "react/jsx-curly-brace-presence": [
        "warn",
        {
          props: "never",
          children: "never",
        },
      ],
      "react/jsx-fragments": ["warn", "syntax"],
      "react/jsx-no-useless-fragment": "warn",
      "react/jsx-pascal-case": "error",
      "react/jsx-sort-props": [
        "warn",
        {
          callbacksLast: true,
          shorthandFirst: true,
          reservedFirst: true,
        },
      ],
      "react/self-closing-comp": "warn",

      // TypeScript sköter props-typerna.
      "react/prop-types": "off",
      "react/require-default-props": "off",
    },
  },

  {
    files: ["tests/**/*.mjs", "jest.config.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2020,
      },
    },
    rules: {
      "no-control-regex": "off",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },

  eslintConfigPrettier,
];
