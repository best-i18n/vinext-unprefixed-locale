import path from 'node:path'
import process from 'node:process'
import { generate } from './generate.ts'
import type { GenerateOptions, GenerateResult } from './generate.ts'

export { generate }
export type { GenerateOptions, GenerateResult }

export interface UnprefixedLocaleOptions extends Omit<GenerateOptions, 'cwd'> {
  /**
   * Regenerate when files under `[locale]` are added, removed or changed, so
   * a new route shows up unprefixed in `vite dev` without a restart.
   *
   * @default true
   */
  watch?: boolean
}

/**
 * The parts of Vite's plugin API this uses, spelled out structurally: `vite`
 * is an optional peer, and a `.d.ts` that imported it would break for anyone
 * who only uses the CLI. The object returned is still a valid Vite plugin.
 */
export interface UnprefixedLocalePlugin {
  name: string
  enforce: 'pre'
  config: (config: { root?: string | undefined }) => void
  configureServer: (server: {
    watcher: {
      on: (
        event: 'all',
        listener: (event: string, file: string) => void,
      ) => unknown
    }
  }) => void
}

/**
 * A Vite plugin for vinext that mirrors `app/[locale]` into a route group
 * pinning the default locale, so `/about` matches a route directly instead
 * of being rewritten onto `/en/about` by a proxy.
 *
 * vinext treats a rewritten request as resolved rather than requested: its
 * RSC navigations are never mapped onto the shared cache key, so with a proxy
 * rewrite every client navigation in the default locale bypasses the CDN
 * cache. With the mirror there is nothing to rewrite.
 *
 * The mirror is written when Vite resolves its config - before vinext scans
 * the app directory - and kept current while `vite dev` runs.
 *
 * @example
 *   // vite.config.ts
 *   import { unprefixedLocale } from '@best-i18n/vinext-unprefixed-locale'
 *
 *   export default defineConfig({
 *     plugins: [
 *       unprefixedLocale({ defaultLocale: 'en', localeParam: 'locale' }),
 *       vinext(),
 *     ],
 *   })
 */
export function unprefixedLocale(
  options: UnprefixedLocaleOptions,
): UnprefixedLocalePlugin {
  const { watch = true, ...rest } = options
  let resolved: GenerateOptions | undefined
  let originDir: string | undefined

  const run = () => {
    if (!resolved) return
    try {
      originDir = generate(resolved).originDir
    } catch (error) {
      console.error(error)
    }
  }

  return {
    name: 'vinext-unprefixed-locale',
    enforce: 'pre',
    config(config) {
      resolved = { ...rest, cwd: path.resolve(config.root ?? process.cwd()) }
      // Throws on a misconfigured app, which should stop the build.
      originDir = generate(resolved).originDir
    },
    configureServer(server) {
      if (!watch) return

      let timer: ReturnType<typeof setTimeout> | undefined
      server.watcher.on('all', (_event, file) => {
        if (!originDir || !file.startsWith(originDir + path.sep)) return
        clearTimeout(timer)
        timer = setTimeout(run, 100)
      })
    },
  }
}
