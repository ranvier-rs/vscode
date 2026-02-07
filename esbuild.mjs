import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const context = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  target: 'node20'
});

if (watch) {
  await context.watch();
  console.log('[esbuild] watching extension sources...');
} else {
  await context.rebuild();
  await context.dispose();
}
