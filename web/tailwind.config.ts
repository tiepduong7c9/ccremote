import type { Config } from 'tailwindcss';
import daisyui from 'daisyui';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  plugins: [daisyui],
  daisyui: {
    themes: ['light', 'dark'],
    darkTheme: 'dark',
  },
} satisfies Config;
