import type { Config } from 'tailwindcss';
import daisyui from 'daisyui';
import typography from '@tailwindcss/typography';
import themes from 'daisyui/src/theming/themes';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  plugins: [typography, daisyui],
  daisyui: {
    themes: [
      {
        light: {
          ...themes['light'],
          // Default amber is too light to read as text/icons on white — darken it.
          warning: '#b45309',
          // Raise overall contrast: darker text + more visible panels/borders.
          'base-content': '#0f172a',
          'base-200': '#eceef1',
          'base-300': '#d4d8dd',
        },
      },
      'dark',
    ],
    darkTheme: 'dark',
  },
} satisfies Config;
