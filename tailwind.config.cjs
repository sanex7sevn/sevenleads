module.exports = {
  content: [
    './public/index.html',
    './public/app.js',
    './public/js/**/*.js'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#010318',
          primary: '#0878ff',
          secondary: '#3b82f6',
          accent: '#1d4ed8'
        }
      }
    }
  },
  plugins: []
};
