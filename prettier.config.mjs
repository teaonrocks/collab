/** @type {import("prettier").Config} */
export default {
  plugins: ["prettier-plugin-tailwindcss"],
  tailwindStylesheet: "./src/renderer/App.css",
  tailwindFunctions: ["cn", "cva"],
  printWidth: 120,
  semi: false,
  trailingComma: "none"
}
