/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'bhr-green': '#00D4A0',
        'bhr-yellow': '#F5C518',
        'bhr-red': '#FF4444',
        'bhr-blue': '#4FC3F7',
        'bhr-purple': '#9C59D1',
        'surface': '#0D1513',
        'surface-2': '#14201D',
        'surface-3': '#1B2925',
        'card-teal': '#0A3B32',
        'card-amber': '#332700',
        'card-purple': '#26133F',
        'card-dark': '#121A25',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
