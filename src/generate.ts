import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { analyzeModule } from './analyze.ts'
import { emitWrapper, PACKAGE } from './emit.ts'
import type { WrapperKind } from './emit.ts'

export interface GenerateOptions {
  /** The locale served without a prefix: `/about` rather than `/en/about`. */
  defaultLocale: string
  /**
   * Name of the dynamic segment holding the locale, as in `app/[locale]`.
   *
   * @default 'locale'
   */
  localeParam?: string
  /**
   * The App Router directory. Resolved against `cwd`.
   *
   * @default 'src/app' if it exists, else 'app'
   */
  appDir?: string
  /**
   * The route group the mirror is written into. Has to be a group - a name
   * in parentheses - so it adds no URL segment.
   *
   * @default '(unprefixed)'
   */
  group?: string
  /**
   * Extensions Next.js treats as route files, as `pageExtensions` in
   * `next.config`. Files under `[locale]` with any other extension are not
   * routes and are left alone.
   *
   * @default ['tsx', 'ts', 'jsx', 'js']
   */
  pageExtensions?: string[]
  /** @default process.cwd() */
  cwd?: string
  /** Suppress the summary line. Warnings are always printed. */
  quiet?: boolean
}

export interface GenerateResult {
  appDir: string
  originDir: string
  outputDir: string
  /** Files created or rewritten, relative to the app dir. */
  written: string[]
  /** Files already up to date. */
  unchanged: string[]
  /** Stale files from an earlier run, now deleted. */
  removed: string[]
  warnings: string[]
}

const DEFAULT_PAGE_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js']
const TYPED_EXTENSIONS = new Set(['ts', 'tsx', 'mts', 'cts'])
const MANIFEST = '.manifest.json'

/** Files that are not routes but Next.js serves from the tree by name. */
const STATIC_METADATA_FILES =
  /^(favicon\.ico|(icon|apple-icon)\d*\.(ico|jpg|jpeg|png|svg)|(opengraph-image|twitter-image)\d*\.(jpg|jpeg|png|gif)|(opengraph-image|twitter-image)\d*\.alt\.txt|sitemap\.xml|robots\.txt|manifest\.(json|webmanifest))$/

/** Extensions the parser reads; any other route file is passed through. */
const LANG_OF: Record<string, true> = {
  ts: true,
  tsx: true,
  mts: true,
  cts: true,
  js: true,
  jsx: true,
  mjs: true,
  cjs: true,
}

interface Planned {
  /** Path relative to the origin dir, posix separators. */
  rel: string
  kind: WrapperKind | 'copy'
  ext: string
}

function classify(basename: string, pageExtensions: string[]): Planned | null {
  const dot = basename.lastIndexOf('.')
  if (dot <= 0) return null
  const name = basename.slice(0, dot)
  const ext = basename.slice(dot + 1)

  if (STATIC_METADATA_FILES.test(basename)) {
    return { rel: basename, kind: 'copy', ext }
  }

  if (!pageExtensions.includes(ext)) return null

  // `page.mdx` and the like: a route file the parser cannot read, so its
  // exports are passed through wholesale.
  const code = ext in LANG_OF
  const passthrough = (kind: WrapperKind): Planned => ({
    rel: basename,
    kind: code ? kind : 'reexport-all',
    ext,
  })

  switch (name) {
    case 'page':
    case 'layout':
    case 'template':
    case 'default':
      return passthrough('segment')
    case 'route':
      return passthrough('handler')
    case 'loading':
    case 'error':
    case 'not-found':
    case 'global-error':
    case 'forbidden':
    case 'unauthorized':
      return { rel: basename, kind: 'reexport', ext }
    case 'sitemap':
    case 'robots':
    case 'manifest':
      return { rel: basename, kind: 'reexport-all', ext }
    default:
      if (/^(icon|apple-icon|opengraph-image|twitter-image)\d*$/.test(name)) {
        return passthrough('image')
      }
      return null
  }
}

function walk(dir: string, rel: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Dotfiles and `_private` folders are outside routing, and so is anything
    // inside them.
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
    if (entry.name === 'node_modules') continue
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) walk(path.join(dir, entry.name), childRel, out)
    else if (entry.isFile()) out.push(childRel)
  }
}

/** URL segments of a route path: route groups and parallel slots removed. */
function routeSegments(rel: string): string[] {
  return path.posix
    .dirname(rel)
    .split('/')
    .filter((segment) => segment !== '.' && segment !== '')
    .filter((segment) => !segment.startsWith('(') && !segment.startsWith('@'))
}

function resolveAppDir(cwd: string, appDir: string | undefined): string {
  if (appDir) return path.resolve(cwd, appDir)
  for (const candidate of ['src/app', 'app']) {
    const resolved = path.resolve(cwd, candidate)
    if (existsSync(resolved) && statSync(resolved).isDirectory())
      return resolved
  }
  throw new Error(
    `[${PACKAGE}] Found neither src/app nor app under ${cwd}. Pass \`appDir\`.`,
  )
}

function readManifest(outputDir: string): string[] {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(outputDir, MANIFEST), 'utf8'),
    ) as { files?: string[] }
    return Array.isArray(parsed.files) ? parsed.files : []
  } catch {
    return []
  }
}

function sameContent(file: string, content: string | Buffer): boolean {
  if (!existsSync(file)) return false
  const current = readFileSync(file)
  return typeof content === 'string'
    ? current.toString('utf8') === content
    : current.equals(content)
}

/** Deletes `dir` and every now-empty parent up to, not including, `stopAt`. */
function pruneEmptyDirs(dir: string, stopAt: string): void {
  let current = dir
  while (current !== stopAt && current.startsWith(stopAt)) {
    if (!existsSync(current) || readdirSync(current).length > 0) return
    rmSync(current, { recursive: true })
    current = path.dirname(current)
  }
}

/**
 * Mirrors `app/[locale]` into a route group whose files pin the default locale,
 * so the default locale's pages match unprefixed URLs directly - no proxy
 * rewrite, no second, hand-written route tree.
 *
 * Idempotent: a file is rewritten only when its content changes, and files
 * from an earlier run whose origin is gone are deleted. Safe to call on every
 * config load.
 */
export function generate(options: GenerateOptions): GenerateResult {
  const cwd = options.cwd ?? process.cwd()
  const localeParam = options.localeParam ?? 'locale'
  const group = options.group ?? '(unprefixed)'
  const pageExtensions = options.pageExtensions ?? DEFAULT_PAGE_EXTENSIONS

  if (!/^\(.+\)$/.test(group)) {
    throw new Error(
      `[${PACKAGE}] \`group\` must be a route group such as '(unprefixed)'; '${group}' would become a URL segment.`,
    )
  }

  const appDir = resolveAppDir(cwd, options.appDir)
  const originName = `[${localeParam}]`
  const originDir = path.join(appDir, originName)
  const outputDir = path.join(appDir, group)

  if (!existsSync(originDir) || !statSync(originDir).isDirectory()) {
    throw new Error(
      `[${PACKAGE}] ${path.relative(cwd, originDir)} does not exist. Routes have to live under a \`[${localeParam}]\` segment; set \`localeParam\` if yours is named differently.`,
    )
  }

  const warnings: string[] = []
  const warn = (message: string) => {
    warnings.push(message)
    console.warn(`[${PACKAGE}] ${message}`)
  }

  const files: string[] = []
  walk(originDir, '', files)
  files.sort()

  const outputs = new Map<string, string | Buffer>()

  for (const rel of files) {
    const planned = classify(path.posix.basename(rel), pageExtensions)
    if (!planned) continue

    const [first] = routeSegments(rel)
    if (first?.startsWith('[')) {
      throw new Error(
        `[${PACKAGE}] ${originName}/${rel} would mirror to /${first}, beside /${originName} at the root, and Next.js does not allow two dynamic segments with different names at one level. Put it under a static segment.`,
      )
    }

    const originPath = path.join(originDir, rel)
    const originLabel = `${originName}/${rel}`

    if (planned.kind === 'copy') {
      outputs.set(rel, readFileSync(originPath))
      continue
    }

    const specifier = path.posix
      .relative(
        path.posix.dirname(path.posix.join(group, rel)),
        path.posix.join(originName, rel),
      )
      .replace(/\.[^./]+$/, '')

    const content = emitWrapper({
      kind: planned.kind,
      specifier: specifier.startsWith('.') ? specifier : `./${specifier}`,
      originLabel,
      exports:
        planned.kind === 'reexport' || planned.kind === 'reexport-all'
          ? {
              names: new Set(),
              literals: new Map(),
              exportsAll: false,
              directives: [],
            }
          : analyzeModule(readFileSync(originPath, 'utf8'), originPath),
      localeParam,
      defaultLocale: options.defaultLocale,
      typed: TYPED_EXTENSIONS.has(planned.ext),
      dynamic: routeSegments(rel).some((segment) => segment.startsWith('[')),
      warn,
    })

    if (content) outputs.set(rel, content)
  }

  // The group is wholly ours, so it ignores itself: nothing to add to the
  // repo's .gitignore, and formatters that honor .gitignore leave it alone.
  outputs.set('.gitignore', '*\n')
  outputs.set(
    MANIFEST,
    `${JSON.stringify({ files: [...outputs.keys()].filter((key) => key !== MANIFEST).sort() }, null, 2)}\n`,
  )

  const previous = readManifest(outputDir)
  const written: string[] = []
  const unchanged: string[] = []
  const removed: string[] = []

  for (const [rel, content] of outputs) {
    const target = path.join(outputDir, rel)
    const label = path.posix.join(group, rel)
    if (sameContent(target, content)) {
      unchanged.push(label)
      continue
    }
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
    written.push(label)
  }

  for (const rel of previous) {
    if (outputs.has(rel)) continue
    const target = path.join(outputDir, rel)
    if (!existsSync(target)) continue
    rmSync(target)
    removed.push(path.posix.join(group, rel))
    pruneEmptyDirs(path.dirname(target), outputDir)
  }

  if (!options.quiet && (written.length > 0 || removed.length > 0)) {
    const routes = [...outputs.keys()].filter(
      (key) => !key.startsWith('.'),
    ).length
    process.stdout.write(
      `[${PACKAGE}] ${originName} → ${group}: ${routes} files mirrored, ${written.length} written, ${removed.length} removed\n`,
    )
  }

  return { appDir, originDir, outputDir, written, unchanged, removed, warnings }
}
