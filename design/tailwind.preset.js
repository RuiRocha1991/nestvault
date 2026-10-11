// Preset Tailwind para o Cofre Familiar. Usa as variáveis CSS de tokens.css (importa-o no globals.css),
// por isso o tema claro/escuro funciona só a mudar data-theme no <html>.
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', sidebar: 'var(--sidebar)', panel: 'var(--panel)', 'panel-2': 'var(--panel-2)', inset: 'var(--inset)',
        line: 'var(--line)', 'line-2': 'var(--line-2)',
        fg: 'var(--fg)', 'fg-2': 'var(--fg-2)', 'fg-3': 'var(--fg-3)',
        accent: 'var(--accent)', 'accent-2': 'var(--accent-2)', 'accent-soft': 'var(--accent-soft)', 'on-accent': 'var(--on-accent)',
        pos: 'var(--pos)', neg: 'var(--neg)', warn: 'var(--warn)',
        c: { orange: '#F2913D', red: '#E5424D', violet: '#6C5CFF', blue: '#3BA7F2', teal: '#2BC6B4', pink: '#E356A8', yellow: '#F2C43D', green: '#3CCB7F' },
      },
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'] },
      fontSize: { xs: ['11px', '1.45'], sm: ['12px', '1.45'], md: ['13px', '1.45'], base: ['14px', '1.45'], lg: ['16px', '1.4'], xl: ['20px', '1.3'], '2xl': ['24px', '1.25'], '3xl': ['30px', '1.2'] },
      spacing: { s1: '4px', s2: '8px', s3: '12px', s4: '16px', s5: '20px', s6: '24px', s8: '32px', s10: '40px', sidebar: '232px' },
      borderRadius: { sm: '6px', md: '8px', lg: '12px', pill: '999px' },
      boxShadow: { card: 'var(--shadow)' },
      backgroundImage: { 'grad-warm': 'linear-gradient(90deg,#F2913D,#E5424D)', 'grad-violet': 'linear-gradient(180deg,#9D6BFF,#6A2BD9)' },
      screens: { drawer: { max: '860px' }, kpi2: { max: '1180px' }, one: { max: '720px' } },
    },
  },
};
