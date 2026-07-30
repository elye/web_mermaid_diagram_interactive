/**
 * Button — minimal, styled with Tailwind.
 */
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = 'ghost', className = '', ...rest }: ButtonProps) {
  const base =
    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const variants: Record<Variant, string> = {
    primary: 'bg-accent text-white hover:opacity-90',
    ghost: 'text-ink hover:bg-surface-alt border border-transparent hover:border-border',
    danger: 'bg-red-500 text-white hover:bg-red-600',
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...rest} />;
}
