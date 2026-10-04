import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    runtime: 'src/runtime.ts',
    cli: 'src/cli.ts',
  },
  sourcemap: true,
  dts: { sourcemap: true },
})
