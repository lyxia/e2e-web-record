import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', runtime: 'src/runtime.ts' },
  format: ['cjs'],
  dts: true,
  clean: true,
  external: ['react', '@babel/core'],
});
