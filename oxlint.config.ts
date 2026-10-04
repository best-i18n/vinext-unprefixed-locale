import { oxlint } from '@debbl/oxc-config'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [oxlint({ react: true })],
  rules: {
    // Every `.sort()` here runs on an array the same expression just built -
    // `[...entry.references].sort()`, `entries.map(key).sort()` - so there is
    // no original to protect and `toSorted()` would only add a copy.
    'unicorn/no-array-sort': 'off',
    // Helpers that capture nothing are still colocated with their one caller
    // on purpose; hoisting them just moves them away from what they explain.
    'unicorn/consistent-function-scoping': 'off',
  },
  overrides: [
    {
      files: ['**/test/**'],
      rules: {
        // Tests embed generated source snippets; `${...}` in a regular string
        // is emitted code, not a missed template.
        'no-template-curly-in-string': 'off',
      },
    },
  ],
})
