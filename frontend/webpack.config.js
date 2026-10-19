const path = require('path');

module.exports = {
  entry: './src/index.ts',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        // Transpile only: TypeScript 7 has no JS API for ts-loader, and `npm run build`
        // type-checks with `tsc --noEmit` first.
        loader: 'esbuild-loader',
        options: { target: 'es2020' },
        exclude: /node_modules/,
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  devServer: {
    static: {
      directory: path.join(__dirname, 'public'),
    },
    compress: true,
    port: 8080,
    proxy: [
      {
        context: ['/api', '/auth', '/socket.io'],
        target: 'http://localhost:3000',
        ws: true,
      },
    ],
  },
};
