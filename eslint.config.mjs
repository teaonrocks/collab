import eslint from "@eslint/js"
import boundaries from "eslint-plugin-boundaries"
import jsxA11y from "eslint-plugin-jsx-a11y"
import reactHooks from "eslint-plugin-react-hooks"
import tseslint from "typescript-eslint"

const architectureElements = [
  { type: "dogfood", pattern: "src/renderer/dogfood-chat", partialMatch: false },
  { type: "renderer-ui", pattern: "src/renderer/ui", partialMatch: false },
  { type: "renderer", pattern: "src/renderer", partialMatch: false },
  { type: "main", pattern: "src/main", partialMatch: false },
  { type: "preload", pattern: "src/preload", partialMatch: false },
  { type: "shared", pattern: "src/shared", partialMatch: false },
  { type: "convex", pattern: "convex", partialMatch: false }
]

export default tseslint.config(
  {
    ignores: ["convex/_generated/**", "coverage/**", "dist/**", "out/**"]
  },
  eslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error"
    },
    plugins: { "react-hooks": reactHooks }
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    ...jsxA11y.flatConfigs.recommended,
    settings: {
      "jsx-a11y": {
        components: {
          Button: "button",
          Input: "input",
          Textarea: "textarea"
        }
      }
    },
    languageOptions: {
      ...jsxA11y.flatConfigs.recommended.languageOptions,
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true }
      }
    }
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    ignores: ["src/renderer/ui/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@base-ui/react", "@base-ui/react/*"],
              message: "Import app-owned primitives from src/renderer/ui instead of reaching into Base UI directly."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/**/*.{ts,tsx}", "convex/**/*.ts"],
    plugins: { boundaries },
    settings: {
      "import/resolver": {
        node: { extensions: [".js", ".jsx", ".ts", ".tsx"] }
      },
      "boundaries/elements": architectureElements,
      "boundaries/files": [
        { category: "code", pattern: "**/*.{ts,tsx}" },
        { category: "dogfood", pattern: "src/renderer/convex-auth.tsx" },
        { category: "dogfood", pattern: "src/renderer/dogfood-chat.tsx" },
        { category: "dogfood", pattern: "src/renderer/dogfood-{chat-adapter,config}.ts" },
        { category: "dogfood", pattern: "src/renderer/main.tsx" },
        { category: "test", pattern: "**/*.test.{ts,tsx}" }
      ]
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          checkInternals: true,
          policies: [
            {
              from: { element: { types: "shared" } },
              disallow: { element: { types: ["main", "preload", "renderer", "renderer-ui", "dogfood", "convex"] } }
            },
            {
              from: { element: { types: "main" } },
              disallow: { element: { types: ["preload", "renderer", "renderer-ui", "dogfood", "convex"] } }
            },
            {
              from: { element: { types: "preload" } },
              disallow: { element: { types: ["main", "renderer", "renderer-ui", "dogfood", "convex"] } }
            },
            {
              from: {
                element: { types: ["renderer", "renderer-ui"] },
                file: { categories: { noneOf: ["dogfood", "test"] } }
              },
              disallow: { element: { types: ["main", "preload", "dogfood", "convex"] } }
            },
            {
              from: {
                element: { types: ["renderer", "renderer-ui"] },
                file: { categories: { noneOf: ["dogfood", "test"] } }
              },
              disallow: { to: { file: { categories: "dogfood" } } }
            },
            {
              from: { element: { types: "dogfood" } },
              disallow: { element: { types: ["main", "preload"] } }
            },
            {
              from: { element: { types: "convex" } },
              disallow: { element: { types: ["main", "preload", "renderer", "renderer-ui", "dogfood"] } }
            }
          ]
        }
      ]
    }
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off"
    }
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked]
  },
  {
    files: ["*.config.js"],
    languageOptions: { globals: { module: "readonly" } }
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } }
  }
)
