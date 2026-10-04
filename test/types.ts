import { unprefixedLocale } from '../src/index.ts'
import type { ReactNode } from 'react'
import type { Plugin } from 'vite'
import type { Arg0, Arg1, Rest, Unprefixed } from '../src/runtime.ts'

/**
 * Compile-time assertions for the wrapper's type helpers; `tsc --noEmit`
 * over the test directory is what runs them.
 */

type Layout = (props: {
  children: ReactNode
  params: Promise<{ lang: string }>
}) => ReactNode

type Page = (props: {
  params: Promise<{ lang: string; slug?: string[] }>
  searchParams: Promise<Record<string, string>>
}) => Promise<ReactNode>

type Handler = (
  request: Request,
  context: { params: Promise<{ lang: string; id: string }> },
) => Response

// The locale key is gone; the rest survives.
const layoutProps: Unprefixed<Arg0<Layout>, 'lang'> = {
  children: null,
  params: Promise.resolve({}),
}
const pageProps: Unprefixed<Arg0<Page>, 'lang'> = {
  params: Promise.resolve({ slug: ['a'] }),
  searchParams: Promise.resolve({}),
}
const context: Unprefixed<Arg1<Handler>, 'lang'> = {
  params: Promise.resolve({ id: '1' }),
}

// A declaration with no parameters yields `unknown`, which accepts anything.
const anything: Unprefixed<Arg0<() => void>, 'lang'> = { whatever: true }
const rest: Rest<(a: number) => void> = []
const restTwo: Rest<(a: number, b: string) => void> = ['x']

// The structurally typed plugin is a real Vite plugin.
const plugin: Plugin = unprefixedLocale({ defaultLocale: 'en' })

export { anything, context, layoutProps, pageProps, plugin, rest, restTwo }
