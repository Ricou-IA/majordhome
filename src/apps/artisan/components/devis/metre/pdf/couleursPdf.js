// src/apps/artisan/components/devis/metre/pdf/couleursPdf.js
// Couleurs des PDF du métré (react-pdf n'a pas Tailwind) : UNE table, mêmes valeurs que tailwind.config.js.
// Comme à l'écran, le cuivre n'y sert pas : pas de statut, pas de titre ; un repère est un disque blanc cerclé.
export const COULEURS_PDF = Object.freeze({
  s100: '#F0EDE7', s200: '#E8E4DC', s300: '#DDD7CD', s400: '#A39A8E', s500: '#736A5F', s600: '#5E564C', s700: '#443E36',
  s800: '#2C2823', s900: '#1C1915', alerte: '#BE3328', blanc: '#FFFFFF',
});
