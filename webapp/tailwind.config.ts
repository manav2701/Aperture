import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Space Grotesk', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
        display: ['Space Grotesk', 'sans-serif'],
      },
      colors: {
        background: '#09090B',
        foreground: '#FAFAFA',
        card: '#09090B',
        muted: '#27272A',
        mutedForeground: '#A1A1AA',
        accent: '#DFE104',
        accentForeground: '#000000',
        border: '#3F3F46',
        input: '#18181B',
        ring: '#DFE104',
        destructive: '#FF3366',
      },
      borderRadius: {
        none: '0px',
        sm: '0px',
        DEFAULT: '0px',
        md: '0px',
        lg: '0px',
        xl: '0px',
        '2xl': '0px',
        '3xl': '0px',
        full: '0px',
      },
      boxShadow: {
        'brutal': '4px 4px 0px #DFE104',
        'brutal-sm': '2px 2px 0px #DFE104',
        'brutal-dark': '4px 4px 0px #3F3F46',
      },
      animation: {
        'marquee-fast': 'marquee 15s linear infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
