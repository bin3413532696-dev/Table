const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

// ── Webpack 配置 ───────────────────────────────────────────

module.exports = (env, argv) => {
  const isDev = argv.mode !== 'production';

  return {
    mode: isDev ? 'development' : 'production',
    entry: './src/index.tsx',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isDev ? '[name].js' : '[name].[contenthash:8].js',
      chunkFilename: isDev ? '[name].bundle.js' : '[name].[contenthash:8].bundle.js',
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.(ts|tsx|js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-react', { runtime: 'automatic', development: isDev }],
                '@babel/preset-env',
                '@babel/preset-typescript',
              ],
            },
          },
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader', 'postcss-loader'],
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      alias: {
        '@huggingface/transformers': path.resolve(__dirname, 'node_modules/@huggingface/transformers/dist/transformers.web.js'),
        'sharp$': false,
        'onnxruntime-node$': false,
        'onnxruntime-web$': false,
      },
      fallback: {
        fs: false,
        path: false,
        url: false,
      },
    },
    devServer: {
      port: 3266,
      allowedHosts: 'all',
      proxy: [
        {
          context: (pathname) => pathname.startsWith('/api/'),
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
      ],
      historyApiFallback: {
        index: '/index.html',
        rewrites: [
          { from: /^\/_p\/\d+\//, to: '/index.html' },
        ],
        disableDotRule: true,
      },

      setupMiddlewares(middlewares) {
        return middlewares;
      },
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './index.html',
        inject: 'body',
      }),
    ],
    optimization: {
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          reactVendor: {
            test: /[\\/]node_modules[\\/](react|react-dom|react-router-dom|scheduler)[\\/]/,
            name: 'react-vendor',
            priority: 30,
          },
          chartVendor: {
            test: /[\\/]node_modules[\\/](recharts|d3)[\\/]/,
            name: 'chart-vendor',
            priority: 25,
          },
          animationVendor: {
            test: /[\\/]node_modules[\\/]framer-motion[\\/]/,
            name: 'animation-vendor',
            priority: 20,
          },
          miscVendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendor',
            priority: 10,
          },
        },
      },
      runtimeChunk: 'single',
    },
  };
};
