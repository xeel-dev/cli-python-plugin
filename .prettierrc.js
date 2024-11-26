import oclifDefault from "@oclif/prettier-config";

export const config = {
  ...oclifDefault,
  "plugins": ["prettier-plugin-organize-imports"],
  "singleQuote": true
}
