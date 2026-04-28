import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        void: '#08080a',
        abyss: '#0f0f12',
        basalt: '#1a1a1f',
        obsidian: '#24242b',
        mist: '#f5f3ef',
        fog: '#8c8a85',
        smoke: '#3d3b38',
        vermillion: '#e64539',
        indigo: '#5b6ef5',
        amber: '#d4912e',
        malachite: '#2ea04a',
      },
      fontFamily: {
        serif: ['Cormorant Garamond', 'Noto Serif SC', 'serif'],
        sans: ['Inter', 'Noto Sans SC', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      maxWidth: {
        chat: '560px',
      },
    },
  },
  plugins: [],
}

export default config
