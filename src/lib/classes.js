import { clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Tailles de texte de tailwind.config.js (fontSize) : sans cette déclaration,
// twMerge prend `text-body-sm` pour une couleur et le retire devant `text-white`.
export const TAILLES_TEXTE_SUR_MESURE = [
  'caption', 'label', 'body-sm', 'cell', 'body', 'section', 'count', 'title', 'kpi',
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: TAILLES_TEXTE_SUR_MESURE }],
    },
  },
});

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
