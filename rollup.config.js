import glslify from './rollup-plugin-glslify-cli';
import postcss from 'rollup-plugin-postcss';
import typescript from 'rollup-plugin-typescript2';

import pkg from './package.json';

const cwd = __dirname;

export default {
  input: 'src/index.ts',
  output: [
    {
      file: pkg.main,
      format: 'cjs',
      sourcemap: true,
    },
    {
      file: pkg.module,
      format: 'es',
      sourcemap: true,
    },
  ],
  external: [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ],
  plugins: [
    glslify(),
    postcss({
      plugins: [require('autoprefixer')],
    }),
    typescript({
      clean: true,
      typescript: require('typescript'),
      useTsconfigDeclarationDir: true,
    }),
  ],
};
