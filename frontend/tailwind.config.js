/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Chart chrome and ink, matching the validated data-viz palette.
        surface: '#fcfcfb',
        plane: '#f9f9f7',
        ink: {
          primary: '#0b0b0b',
          secondary: '#52514e',
          muted: '#898781',
        },
        hairline: '#e1e0d9',
        baseline: '#c3c2b7',
        // Categorical series slots 1 and 2 (validated pair).
        series: {
          income: '#2a78d6',
          expense: '#eb6834',
        },
        // Reserved status palette - never reused as a series colour.
        status: {
          good: '#0ca30c',
          warning: '#fab219',
          serious: '#ec835a',
          critical: '#d03b3b',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
