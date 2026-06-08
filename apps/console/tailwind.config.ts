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
        gold: 'var(--gold)',
        'gold-hover': 'var(--gold-hover)',
        'gold-muted': 'var(--gold-muted)',
        lavender: 'var(--lavender)',
        sky: 'var(--sky)',
        surface: 'var(--surface)',
        'surface-hover': 'var(--surface-hover)',
        qas: {
          app: 'var(--color-bg-app)',
          band: 'var(--color-bg-band)',
          surface: 'var(--color-bg-surface)',
          'surface-muted': 'var(--color-bg-surface-muted)',
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          tertiary: 'var(--color-text-tertiary)',
          border: 'var(--color-border-subtle)',
          accent: 'var(--color-accent-primary)',
          'accent-soft': 'var(--color-accent-soft)',
          success: 'var(--color-signal-success)',
          warning: 'var(--color-signal-warning)',
          danger: 'var(--color-signal-danger)',
          info: 'var(--color-signal-info)',
        },
        workspace: {
          bg: 'var(--color-workspace-bg)',
          surface: 'var(--color-workspace-surface)',
          raised: 'var(--color-workspace-raised)',
          border: 'var(--color-workspace-border)',
          text: 'var(--color-workspace-text)',
          muted: 'var(--color-workspace-muted)',
        },
      },
      fontFamily: {
        serif: ['Cormorant Garamond', 'Noto Serif SC', 'serif'],
        sans: ['Inter', 'Noto Sans SC', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        control: 'var(--radius-control)',
        card: 'var(--radius-card)',
        panel: 'var(--radius-panel)',
        modal: 'var(--radius-modal)',
      },
      boxShadow: {
        raised: 'var(--shadow-raised)',
        workspace: 'var(--shadow-workspace)',
      },
    },
  },
  plugins: [],
}

export default config
