const webpack = require('webpack');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

const { cpus } = require('os');
const { join, resolve } = require('path');
const { existsSync } = require('fs');

const cwd = __dirname;

module.exports = {
  mode: 'development',
  devtool: 'none',
  context: resolve(cwd),
  entry: ['native-promise-only', './src/index.ts'],
  output: {
    filename: 'leaflet.tilelayer.glcolorscale.js',
    path: resolve(cwd, 'dist'),
    library: 'leaflet.tilelayer.glcolorscale',
    libraryTarget: 'umd',
  },
  plugins: [
    new webpack.optimize.OccurrenceOrderPlugin(),
    new ForkTsCheckerWebpackPlugin({ checkSyntacticErrors: true }),
  ],
  resolve: {
    extensions: ['.js', '.ts'],
  },
  module: {
    rules: [
      {
        test: /\.(js|ts)$/,
        include: resolve(cwd, 'src'),
        use: [
          'cache-loader',
          {
            loader: 'thread-loader',
            options: {
              // reserve one cpu for the fork-ts-checker-webpack-plugin
              workers: cpus().length - 1,
            },
          },
          {
            loader: 'ts-loader',
            options: {
              // IMPORTANT! use happyPackMode mode to speed-up compilation and reduce errors reported to webpack
              happyPackMode: true,
            },
          },
        ],
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.glsl$/,
        use: ['raw-loader', 'glslify-loader'],
      },
    ],
  },
  externals: {
    leaflet: {
      commonjs: 'leaflet',
      commonjs2: 'leaflet',
      amd: 'leaflet',
      root: 'Leaflet',
    },
  },
};
