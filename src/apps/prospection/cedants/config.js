/**
 * config.js — Configuration module Cédants (acquisition)
 */

export const CEDANTS_NAF_CODES = ['43.22A', '43.22B', '43.21A'];

export const CEDANTS_DEPARTEMENTS = ['81', '12', '31', '82', '46', '32'];

export const CEDANTS_STATUSES = [
  { key: 'nouveau',        label: 'Nouveau',        color: '#94a3b8', order: 1 },
  { key: 'a_creuser',      label: 'À creuser',      color: '#60a5fa', order: 2 },
  { key: 'priorite_b',     label: 'Priorité B',     color: '#a78bfa', order: 3 },
  { key: 'priorite_a',     label: 'Priorité A',     color: '#f59e0b', order: 4 },
  { key: 'contact_initie', label: 'Contact initié', color: '#34d399', order: 5 },
  { key: 'rdv_fixe',       label: 'RDV fixé',       color: '#2dd4bf', order: 6 },
  { key: 'negociation',    label: 'Négociation',    color: '#fb923c', order: 7 },
  { key: 'acquis',         label: 'Acquis',         color: '#22c55e', order: 8 },
  { key: 'abandonne',      label: 'Abandonné',      color: '#ef4444', order: 9 },
];

export const CEDANTS_TRANSITIONS = {
  nouveau:        ['a_creuser', 'abandonne'],
  a_creuser:      ['priorite_b', 'priorite_a', 'abandonne'],
  priorite_b:     ['priorite_a', 'contact_initie', 'abandonne'],
  priorite_a:     ['contact_initie', 'abandonne'],
  contact_initie: ['rdv_fixe', 'abandonne'],
  rdv_fixe:       ['negociation', 'abandonne'],
  negociation:    ['acquis', 'abandonne'],
  acquis:         [],
  abandonne:      [],
};
