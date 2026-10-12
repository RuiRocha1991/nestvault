import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '../cn';

const buttonStyles = cva(
  [
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border',
    'text-md font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        default: 'border-line-2 bg-panel-2 text-fg hover:border-accent-2',
        primary: 'border-accent bg-accent text-on-accent hover:border-accent-2 hover:bg-accent-2',
        ghost: 'border-transparent bg-transparent text-fg-2 hover:bg-panel-2 hover:text-fg',
        danger:
          'border-transparent bg-transparent text-neg hover:bg-panel-2 disabled:hover:bg-transparent',
      },
      size: {
        md: 'h-[34px] px-3.5',
        sm: 'h-7 px-2.5 text-sm',
      },
      icon: { true: 'px-0', false: '' },
    },
    compoundVariants: [
      { icon: true, size: 'md', class: 'w-[34px]' },
      { icon: true, size: 'sm', class: 'w-7' },
    ],
    defaultVariants: { variant: 'default', size: 'md', icon: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {}

export function Button({ className, variant, size, icon, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonStyles({ variant, size, icon }), className)}
      {...props}
    />
  );
}
