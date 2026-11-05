/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sky: {
          50: '#eff9ff',
          100: '#dcf2ff',
          200: '#b2e6ff',
          300: '#6ed3ff',
          400: '#22bcff',
          500: '#0aa2f0',
          600: '#0082ce',
          700: '#0067a7',
          800: '#075789',
          900: '#0c4971',
          950: '#082f4a'
        },
        ink: {
          950: '#06080c',
          900: '#0a0e14',
          850: '#0e131b',
          800: '#121924',
          750: '#161f2c',
          700: '#1c2736',
          600: '#26344a',
          500: '#3a4c66'
        }
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace']
      },
      boxShadow: {
        panel: '0 18px 48px -24px rgba(0, 0, 0, 0.85)',
        glow: '0 0 0 1px rgba(34, 188, 255, 0.28), 0 12px 40px -16px rgba(34, 188, 255, 0.45)'
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'none' } },
        'pulse-rec': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.86)' }
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } }
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out both',
        'scale-in': 'scale-in 160ms ease-out both',
        'pulse-rec': 'pulse-rec 1.4s ease-in-out infinite',
        shimmer: 'shimmer 1.6s infinite'
      }
    }
  },
  plugins: []
}
