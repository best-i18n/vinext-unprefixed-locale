import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Writes a throwaway app directory: `files` maps paths relative to
 * `[lang]` to their content. Returns the project root, which is what
 * `generate({ cwd })` wants.
 */
export function project(
  files: Record<string, string>,
  { appDir = 'src/app', param = 'lang' } = {},
): string {
  const root = mkdtempSync(path.join(tmpdir(), 'vinext-unprefixed-locale-'))
  const origin = path.join(root, appDir, `[${param}]`)
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(origin, rel)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  return root
}
