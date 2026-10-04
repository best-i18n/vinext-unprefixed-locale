#!/usr/bin/env node
import { watch } from 'node:fs'
import process from 'node:process'
import { cac } from 'cac'
import { PACKAGE } from './emit.ts'
import { generate } from './generate.ts'

const cli = cac('vinext-unprefixed-locale')

cli
  .command(
    '',
    'Mirror app/[locale] into a route group that pins the default locale',
  )
  .option('--locale <locale>', 'The locale served unprefixed (required)')
  .option('--param <name>', 'Name of the locale segment: [locale]', {
    default: 'locale',
  })
  .option('--app <dir>', 'App Router directory (default: src/app, else app)')
  .option('--group <name>', 'Route group to write into', {
    default: '(unprefixed)',
  })
  .option('--ext <list>', 'Comma-separated page extensions', {
    default: 'tsx,ts,jsx,js',
  })
  .option('--watch', 'Keep running and regenerate on changes')
  .option('--quiet', 'Print warnings only')
  .action(
    (flags: {
      locale?: string
      param: string
      app?: string
      group: string
      ext: string
      watch?: boolean
      quiet?: boolean
    }) => {
      if (!flags.locale) {
        console.error('--locale is required, e.g. --locale en')
        process.exit(1)
      }

      const options = {
        defaultLocale: flags.locale,
        localeParam: flags.param,
        appDir: flags.app,
        group: flags.group,
        pageExtensions: flags.ext.split(',').map((ext) => ext.trim()),
        quiet: flags.quiet,
      }

      const result = generate(options)

      if (!flags.watch) return

      let timer: ReturnType<typeof setTimeout> | undefined
      watch(result.originDir, { recursive: true }, () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          try {
            generate(options)
          } catch (error) {
            console.error(error)
          }
        }, 100)
      })
      console.warn(`[${PACKAGE}] watching ${result.originDir}`)
    },
  )

cli.help()
cli.parse()
