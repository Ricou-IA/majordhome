import { cva } from 'class-variance-authority';

// Anciens noms (shadcn) acceptés par les appelants existants.
const ALIAS_VARIANTES = { default: 'primary', outline: 'secondary', destructive: 'danger' };
const ALIAS_TAILLES = { default: 'md', lg: 'md' };
const VARIANTES = ['primary', 'secondary', 'ghost', 'link', 'danger'];
const TAILLES = ['md', 'sm', 'icon'];

export function normaliserVariante(variant) {
  const v = ALIAS_VARIANTES[variant] || variant;
  return VARIANTES.includes(v) ? v : 'primary';
}

export function normaliserTaille(size) {
  const s = ALIAS_TAILLES[size] || size;
  return TAILLES.includes(s) ? s : 'md';
}

const cvaBouton = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-body-sm font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary-600 text-white shadow-xs hover:bg-primary-700',
        secondary: 'border border-secondary-300 bg-white text-secondary-800 shadow-xs hover:bg-secondary-50',
        ghost: 'text-secondary-600 hover:bg-secondary-100',
        link: 'font-semibold text-primary-700 hover:underline',
        danger: 'border border-secondary-300 bg-white text-st-alerte hover:bg-st-alerte-bg',
      },
      size: {
        md: 'h-[38px] px-4',
        sm: 'h-8 px-3',
        icon: 'h-[38px] w-[38px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export function buttonVariants({ variant, size, className } = {}) {
  return cvaBouton({
    variant: normaliserVariante(variant),
    size: normaliserTaille(size),
    className,
  });
}
