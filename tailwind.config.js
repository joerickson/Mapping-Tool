/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        rbm: {
          blue: '#1a56db',
          navy: '#1e3a5f',
          green: '#0e9f6e',
          red: '#f05252',
          yellow: '#faca15',
          purple: '#7e3af2',
          orange: '#ff5a1f',
          teal: '#0694a2',
          pink: '#e74694',
          gray: '#6b7280',
        }
      }
    },
  },
  plugins: [],
}
