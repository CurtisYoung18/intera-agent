import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/shared/ui/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        void: 'var(--void)',
        abyss: 'var(--abyss)',
        basalt: 'var(--basalt)',
        obsidian: 'var(--obsidian)',
        mist: 'var(--mist)',
        fog: 'var(--fog)',
        smoke: 'var(--smoke)',
        vermillion: 'var(--vermillion)',
        indigo: 'var(--indigo)',
        amber: 'var(--amber)',
        malachite: 'var(--malachite)',
      },
      fontFamily: {
        serif: ['Cormorant Garamond', 'Noto Serif SC', 'serif'],
        sans: ['Inter', 'Noto Sans SC', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
