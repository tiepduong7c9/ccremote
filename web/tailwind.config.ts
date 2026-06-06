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
        },
      },
      'dark',
    ],
    darkTheme: 'dark',
  },
} satisfies Config;
