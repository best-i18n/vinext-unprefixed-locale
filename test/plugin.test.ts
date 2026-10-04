import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { unprefixedLocale } from '../src/index.ts'
import { project } from './helpers.ts'

const roots: string[] = []

function make(): string {
  const root = project(
    { 'about/page.tsx': 'export default function About() { return null }\n' },
    { appDir: 'app', param: 'lang' },
  )
  roots.push(root)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const mirrored = (root: string, rel: string, group = '(unprefixed)') =>
  existsSync(path.join(root, `app/${group}/${rel}`))

/** A stand-in for Vite's dev server: records the watcher's listener. */
function devServer() {
  let listener: ((event: string, file: string) => void) | undefined
  return {
    server: {
      watcher: {
        on: (_event: 'all', fn: (event: string, file: string) => void) => {
          listener = fn
        },
      },
    },
    emit: (event: string, file: string) => listener?.(event, file),
    get listening() {
      return listener !== undefined
    },
  }
}

describe('unprefixedLocale', () => {
  it('mirrors under the Vite root when the config resolves', () => {
    const root = make()
    const plugin = unprefixedLocale({
      defaultLocale: 'en',
      localeParam: 'lang',
    })

    expect(plugin.name).toBe('vinext-unprefixed-locale')
    expect(plugin.enforce).toBe('pre')
    expect(mirrored(root, 'about/page.tsx')).toBe(false)

    plugin.config({ root })

    expect(mirrored(root, 'about/page.tsx')).toBe(true)
  })

  it('passes its own options through', () => {
    const root = make()
    unprefixedLocale({
      defaultLocale: 'en',
      localeParam: 'lang',
      group: '(root)',
    }).config({ root })

    expect(mirrored(root, 'about/page.tsx', '(root)')).toBe(true)
  })

  it('throws when the locale segment is missing', () => {
    const root = make()
    const plugin = unprefixedLocale({ defaultLocale: 'en' })

    expect(() => plugin.config({ root })).toThrow('[locale]')
  })

  it('regenerates in dev when a route is added under the locale segment', () => {
    vi.useFakeTimers()
    const root = make()
    const plugin = unprefixedLocale({
      defaultLocale: 'en',
      localeParam: 'lang',
    })
    const dev = devServer()
    plugin.config({ root })
    plugin.configureServer(dev.server)

    const page = path.join(root, 'app/[lang]/blog/page.tsx')
    mkdirSync(path.dirname(page), { recursive: true })
    writeFileSync(page, 'export default function Blog() { return null }\n')

    // Outside the locale segment: ignored.
    dev.emit('add', path.join(root, 'app/sitemap.ts'))
    vi.advanceTimersByTime(200)
    expect(mirrored(root, 'blog/page.tsx')).toBe(false)

    dev.emit('add', page)
    vi.advanceTimersByTime(200)
    expect(mirrored(root, 'blog/page.tsx')).toBe(true)
  })

  it('does not watch with `watch: false`', () => {
    const root = make()
    const plugin = unprefixedLocale({
      defaultLocale: 'en',
      localeParam: 'lang',
      watch: false,
    })
    const dev = devServer()
    plugin.config({ root })
    plugin.configureServer(dev.server)

    expect(dev.listening).toBe(false)
  })
})
