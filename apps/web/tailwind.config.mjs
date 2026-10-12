import preset from '../../design/tailwind.preset.js';

/** @type {import('tailwindcss').Config} */
export default {
  // The design preset is plain CommonJS without types.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  presets: [preset],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // next/font registers the self-hosted families under generated names; tokens.css maps them.
      fontFamily: { sans: ['var(--font)'], mono: ['var(--mono)'] },
    },
  },
};
