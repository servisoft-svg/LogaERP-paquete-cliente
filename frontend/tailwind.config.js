/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        loga: {
          red:         '#FF0000',
          'red-dark':  '#CC0000',
          'red-light': '#FF4444',
          white:       '#FFFFFF',
          gray:        '#F5F5F5',
          'gray-mid':  '#E0E0E0',
          'gray-dark': '#333333',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'fill-up':    'fillUp 2.5s ease-in-out infinite',
        'wave':       'wave 3s ease-in-out infinite',
        'pulse-red':  'pulseRed 2s ease-in-out infinite',
        'shimmer':    'shimmer 2s infinite',
        'fade-in':    'fadeIn 0.3s ease-out',
        'slide-up':   'slideUp 0.3s ease-out',
      },
      keyframes: {
        fillUp: {
          '0%':   { height: '0%',   opacity: '0.8' },
          '50%':  { height: '65%',  opacity: '0.95' },
          '100%': { height: '100%', opacity: '1' },
        },
        wave: {
          '0%, 100%': { transform: 'translateX(-100%)' },
          '50%':      { transform: 'translateX(100%)' },
        },
        pulseRed: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255,0,0,0.4)' },
          '50%':      { boxShadow: '0 0 0 12px rgba(255,0,0,0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
