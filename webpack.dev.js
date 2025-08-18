const { merge } = require('webpack-merge');
const ESLintPlugin = require('eslint-webpack-plugin');
const path = require('path');
const common = require('./webpack.common.js');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'eval-cheap-module-source-map', // TODO add multiple webpack conf
  performance: {
    hints: "warning"
  },
  plugins: [
    new ESLintPlugin({
      overrideConfigFile: path.resolve(__dirname, 'eslint.config.mjs'),
      extensions: ['js'],
      exclude: ['node_modules', 'src/js/vendor']
    })
  ],
});


