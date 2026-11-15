/** @type {import('tailwindcss').Config} */

/*
 * "Ink and highlighter": the app's neutrals are paper (light end) running into
 * blue-black ink (dark end), and the accent is fountain-pen blue. The whole UI
 * uses the `slate` and `indigo` scales, so redefining them here restyles everything.
 */
const paperInk = {
  50: '#F4F5F1', // paper: app background
  100: '#EAECE6',
  200: '#DADDD6', // rule: hairlines
  300: '#C2C6BE',
  400: '#8C929A',
  500: '#646B75', // pencil: secondary text
  600: '#4A515D',
  700: '#353C49',
  800: '#242B38',
  900: '#1A202B', // night sheet
  950: '#121620', // night paper
};
const pen = {
  50: '#EEF1FD',
  100: '#DCE2FB',
  200: '#BAC6F7',
  300: '#8E9FFF',
  400: '#6A80F0',
  500: '#4560DE',
  600: '#2340C8', // pen blue: actions, focus, active
  700: '#1C33A4',
  800: '#1A2C82',
  900: '#192766',
  950: '#10183F',
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        slate: paperInk,
        indigo: pen,
        ink: '#1A2233',
      },
      fontFamily: {
        sans: ['"Schibsted Grotesk Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
