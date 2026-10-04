import { createElement, useMemo } from 'react'
import type { ComponentType, ReactNode } from 'react'

/**
 * The half of the package a generated wrapper imports at runtime. Everything
 * here is framework-agnostic plumbing: put the locale into `params`, then hand
 * the call on to the original module.
 */

/**
 * The origin's props with the locale key taken back out of `params`: what the
 * mirrored route actually receives, since its URL has no locale segment. The
 * wrapper is typed with this so `vinext typegen`'s validator sees a component
 * that accepts the unprefixed route's params.
 */
export type Unprefixed<P, K extends string> = P extends {
  params: Promise<infer R>
}
  ? Omit<P, 'params'> & { params: Promise<Omit<R, K>> }
  : P

/** First parameter type, `unknown` for a function that declares none. */
export type Arg0<F> = F extends (first: infer A, ...rest: any[]) => any
  ? A
  : never

/** Second parameter type, `unknown` for a function that declares fewer. */
export type Arg1<F> = F extends (
  first: any,
  second: infer B,
  ...rest: any[]
) => any
  ? B
  : never

/** Every parameter after the first, to forward untouched. */
export type Rest<F> = F extends (first: any, ...rest: infer R) => any
  ? R
  : never

/**
 * Returns `props` with `params` resolving to the original params plus the
 * locale. A fresh promise rather than a patched one: the incoming `params` is
 * Next's own and its value is not ours to mutate. Works on a route handler's
 * `context` the same way, and on `undefined` for a caller that passed nothing.
 */
export function pin<T>(props: T, key: string, value: string): T {
  const source = (props ?? {}) as Record<string, unknown>
  return { ...source, params: pinParams(source.params, key, value) } as T
}

function pinParams(
  params: unknown,
  key: string,
  value: string,
): Promise<Record<string, unknown>> {
  return Promise.resolve(params).then((resolved) => ({
    ...(resolved as Record<string, unknown> | undefined),
    [key]: value,
  }))
}

/**
 * `pin` for a `'use client'` wrapper, which re-renders: the pinned promise is
 * memoized on the incoming one, so the origin's `use(params)` sees the same
 * promise each time instead of suspending on a fresh one every render.
 *
 * A client origin gets a client wrapper rather than a server one because the
 * framework hands client pages their `params` and `searchParams` through its
 * own client boundary. A server wrapper forwarding the server-side
 * `searchParams` to a client component would have React resolve it during
 * prerender, which makes the page dynamic and keeps it out of the cache.
 */
export function usePinned<T>(props: T, key: string, value: string): T {
  const source = (props ?? {}) as Record<string, unknown>
  const incoming = source.params
  const params = useMemo(
    () => pinParams(incoming, key, value),
    [incoming, key, value],
  )
  return { ...source, params } as T
}

/**
 * Calls a function with whatever arguments the wrapper has, regardless of how
 * many the origin declared. A wrapper cannot know that - a `generateMetadata`
 * may take zero, one or two parameters - and TypeScript would reject a direct
 * call with more arguments than the declaration lists.
 */
export function call<F extends (...args: any[]) => any>(
  fn: F,
  ...args: unknown[]
): ReturnType<F> {
  return fn(...args)
}

/**
 * Renders the origin's component with the pinned props. An element, not a
 * call: a `'use client'` page reaches the wrapper as a client reference, which
 * the server can render but not invoke.
 */
export function render(component: unknown, props: unknown): ReactNode {
  return createElement(
    component as ComponentType<Record<string, unknown>>,
    props as Record<string, unknown>,
  )
}

/**
 * Runs the origin's `generateStaticParams` as if the locale segment above it
 * had produced the default locale, then drops the locale key: the mirrored
 * route has no such segment, and an unknown key would not match its params.
 *
 * Params the origin returns for another locale are left out. An origin that
 * derives its params from the parent's - the idiomatic shape - never returns
 * any; one that enumerates every locale itself is filtered here.
 */
export async function staticParams(
  fn: unknown,
  props: unknown,
  key: string,
  value: string,
): Promise<Array<Record<string, unknown>>> {
  const source = (props ?? {}) as { params?: Record<string, unknown> }
  const generate = fn as (props: unknown) => unknown
  const result = (await generate({
    ...source,
    params: { ...source.params, [key]: value },
  })) as Array<Record<string, unknown>>

  return result
    .filter((params) => params[key] === undefined || params[key] === value)
    .map(({ [key]: _locale, ...rest }) => rest)
}
