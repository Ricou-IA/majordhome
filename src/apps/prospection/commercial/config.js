/**
 * config.js — Configuration module Commercial (prospection)
 */

export const COMMERCIAL_NAF_CODES = []; // Configurable, vide par défaut

export const COMMERCIAL_DEPARTEMENTS = []; // Pas de filtre par défaut

export const COMMERCIAL_STATUSES = [
  { key: 'a_contacter',     label: 'À contacter',     color: '#60a5fa', order: 1 },
  { key: 'contact_initie',  label: 'Contact initié',  color: '#34d399', order: 2 },
  { key: 'rdv_fixe',        label: 'RDV fixé',        color: '#2dd4bf', order: 3 },
  { key: 'proposition',     label: 'Proposition',     color: '#f59e0b', order: 4 },
  { key: 'converti',        label: 'Converti',        color: '#22c55e', order: 5 },
  { key: 'non_interesse',   label: 'Non intéressé',   color: '#ef4444', order: 6 },
];

export const COMMERCIAL_TRANSITIONS = {
  a_contacter:    ['contact_initie', 'non_interesse'],
  contact_initie: ['rdv_fixe', 'non_interesse'],
  rdv_fixe:       ['proposition', 'non_interesse'],
  proposition:    ['converti', 'non_interesse'],
  converti:       [],
  non_interesse:  [],
};
