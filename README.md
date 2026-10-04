# @best-i18n/vinext-unprefixed-locale

Serve the default locale unprefixed on [vinext](https://github.com/cloudflare/vinext) -
`/about` and `/zh/about`, not `/en/about` - without a proxy rewrite, so
default-locale navigations stay cacheable.

```text
app/
  [locale]/          what you write
    layout.tsx
    blog/[...slug]/page.tsx
  (unprefixed)/      what this generates, gitignored
    layout.tsx       → imports [locale]/layout, params.locale pinned to 'en'
    blog/[...slug]/page.tsx
```

## Why

Routes under `app/[locale]` give every language a prefix. Hiding it for the
default locale is usually a proxy that rewrites `/about` onto `/en/about`. On
vinext that rewrite costs the cache: a rewritten request is _resolved_ rather
than _requested_, and only requested RSC navigations are mapped onto the shared
cache key. Every client navigation in the default locale answers
`Cache-Control: no-store` - a Cloudflare `BYPASS` on every page change -
while the prefixed locales hit the cache.

This package removes the rewrite. It mirrors `app/[locale]` into a route group
whose files import the originals and pin the locale, so `/about` matches a
route directly. It is the mirror from
[`@best-i18n/next-unprefixed-locale`](https://github.com/best-i18n/next-unprefixed-locale),
run from a Vite plugin and meant for a server.

## Setup

```bash
pnpm add @best-i18n/vinext-unprefixed-locale
```

```ts
// vite.config.ts
import { unprefixedLocale } from '@best-i18n/vinext-unprefixed-locale'
import vinext from 'vinext'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    unprefixedLocale({ defaultLocale: 'en', localeParam: 'locale' }),
    vinext(),
  ],
})
```

The mirror is written when Vite resolves its config, before vinext scans the
app directory, and regenerated while `vite dev` runs whenever a file under
`[locale]` changes. Then take the rewrite out of the proxy.

On a server `[locale]` still sits at the root, so:

- **Redirect `/en/...`** to its unprefixed URL, e.g. with `redirects()` in
  `next.config.ts`.
- **Validate the locale in `[locale]/layout.tsx`** and call `notFound()` for
  anything else: an unknown single-segment path such as `/foo` now reaches
  `[locale]` as `locale: 'foo'` instead of being rewritten to `/en/foo`. Do not
  use `dynamicParams = false` for this; it cascades to every segment below.
- **Fall back to the default locale** where the server reads the locale from
  the `[locale]` root param: mirrored routes have no such segment.

## Options

| Option           | Default               |                                                                          |
| ---------------- | --------------------- | ------------------------------------------------------------------------ |
| `defaultLocale`  | required              | The locale served unprefixed.                                            |
| `localeParam`    | `'locale'`            | Name of the segment: `[locale]`, `[lang]`.                               |
| `appDir`         | `src/app`, else `app` | Relative to the Vite root.                                               |
| `group`          | `'(unprefixed)'`      | Where the mirror goes. Must be a route group, so it adds no URL segment. |
| `pageExtensions` | `tsx ts jsx js`       | Which files are routes.                                                  |
| `watch`          | `true`                | Regenerate in `vite dev` when files under `[locale]` change.             |
| `quiet`          | `false`               | Skip the one-line summary. Warnings are always printed.                  |

`generate(options)` is exported too, and there is a CLI for the same:

```bash
vinext-unprefixed-locale --locale en          # once
vinext-unprefixed-locale --locale en --watch  # keep going
```

## What is generated

| In `[locale]`                                            | In the mirror                                                                                                                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`, `layout`, `template`, `default`                  | A component rendering the original with `params` pinned. `generateMetadata`, `generateViewport` and `generateStaticParams` are wrapped the same way; `metadata` and `viewport` are re-exported. |
| `route`                                                  | One function per HTTP method, `context.params` pinned, plus `generateStaticParams`.                                                                                                             |
| `opengraph-image`, `twitter-image`, `icon`, `apple-icon` | The default export and `generateImageMetadata` pinned; `alt`, `size`, `contentType` re-exported.                                                                                                |
| `loading`, `error`, `not-found`, `global-error`          | Re-exported as they are; they take no params.                                                                                                                                                   |
| `favicon.ico`, `icon.png`, `robots.txt`, …               | Copied.                                                                                                                                                                                         |
| Anything else - components, helpers, styles              | Left alone. The wrappers import the originals, which resolve their own neighbours.                                                                                                              |

Route segment config - `dynamic`, `revalidate` and the rest - is repeated as a
literal, because it is read by static analysis and a re-exported binding would
not be seen. A `'use client'` page gets a `'use client'` wrapper. The group
carries its own `.gitignore`.

## Limits

- **No dynamic segment directly under `[locale]`.** `[locale]/[slug]` would
  mirror to `/[slug]`, beside `/[locale]` at the root, and two dynamic
  segments with different names cannot share a level.
- **Two root layouts.** `[locale]/layout.tsx` and its mirror each render
  `<html>`, so switching locale is a full page load.
- **`export *`** in a route file hides its exports from the mirror.

## License

MIT
