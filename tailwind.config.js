/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        uvm: {
          blue: '#1e3a5f',
          gold: '#c8a951',
        },
      },
    },
  },
  plugins: [],
};
