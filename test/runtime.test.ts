import { describe, expect, it } from 'vitest'
import { call, pin, render, staticParams } from '../src/runtime.ts'

describe('pin', () => {
  it('adds the locale to the resolved params and keeps every other prop', async () => {
    const props = {
      params: Promise.resolve({ slug: ['a'] }),
      searchParams: Promise.resolve({ q: '1' }),
      children: 'kids',
    }
    const pinned = pin(props, 'lang', 'en')

    await expect(pinned.params).resolves.toEqual({ slug: ['a'], lang: 'en' })
    expect(pinned.searchParams).toBe(props.searchParams)
    expect(pinned.children).toBe('kids')
    // The origin's promise is not touched.
    await expect(props.params).resolves.toEqual({ slug: ['a'] })
  })

  it('copes with props that have no params, or no props at all', async () => {
    await expect(
      pin<Record<string, unknown>>({ children: 1 }, 'lang', 'en').params,
    ).resolves.toEqual({
      lang: 'en',
    })
    await expect(
      pin(undefined as unknown as object, 'lang', 'en'),
    ).toMatchObject({})
  })
})

describe('staticParams', () => {
  it('hands the origin the default locale as parent param and strips it from the result', async () => {
    const seen: unknown[] = []
    const origin = ({ params }: { params: { lang: string } }) => {
      seen.push(params)
      return [{ lang: params.lang, slug: ['a'] }, { slug: ['b'] }]
    }

    await expect(
      staticParams(origin, { params: { other: 1 } }, 'lang', 'en'),
    ).resolves.toEqual([{ slug: ['a'] }, { slug: ['b'] }])
    expect(seen).toEqual([{ other: 1, lang: 'en' }])
  })

  it('drops params the origin returned for other locales', async () => {
    const origin = async () => [
      { lang: 'zh', slug: ['a'] },
      { lang: 'en', slug: ['a'] },
    ]
    await expect(
      staticParams(origin, undefined, 'lang', 'en'),
    ).resolves.toEqual([{ slug: ['a'] }])
  })
})

describe('call and render', () => {
  it('forwards however many arguments the wrapper has', () => {
    const zero = () => 'z'
    const two = (a: number, b: number) => a + b
    expect(call(zero, 1, 2)).toBe('z')
    expect(call(two, 1, 2)).toBe(3)
  })

  it('builds an element rather than invoking the component', () => {
    let invoked = false
    const Component = () => {
      invoked = true
      return null
    }
    const element = render(Component, { params: 'p' }) as {
      type: unknown
      props: unknown
    }
    expect(invoked).toBe(false)
    expect(element.type).toBe(Component)
    expect(element.props).toEqual({ params: 'p' })
  })
})
