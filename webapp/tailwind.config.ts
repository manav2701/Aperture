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
        sans: ['var(--font-inter)'],
        mono: ['var(--font-jetbrains-mono)', 'Consolas', 'monospace'],
        orbitron: ['Orbitron', 'var(--font-jetbrains-mono)', 'monospace'],
      },
      colors: {
        background: '#0a0a0f',
        foreground: '#e0e0e0',
        card: '#12121a',
        muted: '#1c1c2e',
        mutedForeground: '#6b7280',
        accent: '#00ff88',
        accentSecondary: '#ff00ff',
        accentTertiary: '#00d4ff',
        border: '#2a2a3a',
        input: '#12121a',
        ring: '#00ff88',
        destructive: '#ff3366',
      },
      boxShadow: {
        'neon': '0 0 5px #00ff88, 0 0 10px #00ff8840',
        'neon-sm': '0 0 3px #00ff88, 0 0 6px #00ff8830',
        'neon-lg': '0 0 10px #00ff88, 0 0 20px #00ff8860, 0 0 40px #00ff8830',
        'neon-secondary': '0 0 5px #ff00ff, 0 0 20px #ff00ff60',
        'neon-tertiary': '0 0 5px #00d4ff, 0 0 20px #00d4ff60',
      },
      animation: {
        'blink': 'blink 1s step-end infinite',
        'glitch': 'glitch 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both',
        'scanline': 'scanline 8s linear infinite',
        'rgb-shift': 'rgbShift 2s ease-in-out infinite',
      },
      keyframes: {
        blink: {
          '50%': { opacity: '0' },
        },
        glitch: {
          '0%, 100%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-2px, 2px)' },
          '40%': { transform: 'translate(2px, -2px)' },
          '60%': { transform: 'translate(-1px, -1px)' },
          '80%': { transform: 'translate(1px, 1px)' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        rgbShift: {
          '0%, 100%': { textShadow: '-2px 0 #ff00ff, 2px 0 #00d4ff' },
          '50%': { textShadow: '2px 0 #ff00ff, -2px 0 #00d4ff' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
