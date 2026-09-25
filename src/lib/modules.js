// src/lib/modules.js
// ============================================================================
// Découpage de Majord'home en MODULES — le découpage COMMERCIAL (décision Eric,
// 2026-09-13) : un socle toujours inclus, puis des modules vendables. Module
// PUR (aucun import React) : testé par `node --test scripts/modules.test.mjs`.
//
// Aujourd'hui il porte les tuiles de la page Paramètres, groupées par module ;
// demain la sidebar et l'activation par organisation (`settings.modules`) s'y
// brancheront : un client sans le module Entretiens ne verra ni le menu ni le
// paramétrage correspondant, d'un seul drapeau.
//
// Règle de rangement : le SOCLE porte ce qui décrit l'entreprise et son parc
// client (organisation, équipe, droits, référentiel d'équipements, fournisseurs,
// pipeline commercial, chantiers) ; un module porte ce qui VALORISE ce socle
// (l'entretien tarifie et planifie le parc, la communication lui parle…).
// Les icônes sont des noms lucide-react, résolus par la page (module pur).
// ============================================================================

export const MODULES = [
  {
    key: 'socle',
    label: 'Socle',
    description: 'Votre entreprise, votre équipe, vos clients et leur parc — toujours inclus.',
    tiles: [
      { key: 'organization', title: 'Organisation', description: 'Identité, coordonnées, siège et territoire', icon: 'Building2', href: '/settings/organization', adminOnly: true, horsCrm: true },
      { key: 'team', title: 'Équipe', description: 'Membres, rôles, couleur planning, compétences', icon: 'Users', href: '/settings/team', adminOnly: true },
      { key: 'permissions', title: 'Droits d\'accès', description: 'Permissions par rôle', icon: 'Shield', href: '/settings/permissions', adminOnly: true },
      { key: 'equipements', title: 'Équipements', description: 'Catégories et types d\'équipement du parc client', icon: 'Wrench', href: '/settings/equipements', adminOnly: true },
      { key: 'suppliers', title: 'Fournisseurs & catalogue', description: 'Fournisseurs et catalogues produits', icon: 'Truck', href: '/settings/suppliers', adminOnly: true },
      { key: 'pennylane', title: 'Facturation', description: 'Numérotation, mentions et coordonnées bancaires des factures ; lien Pennylane et comptes de vente', icon: 'Receipt', href: '/settings/pennylane', adminOnly: true },
      { key: 'plan-comptable', title: 'Plan comptable', description: 'Les comptes de vente Pennylane utilisables dans Majord\'home', icon: 'BookOpen', href: '/settings/plan-comptable', adminOnly: true },
    ],
  },
  {
    key: 'entretiens',
    label: 'Entretiens & Contrats',
    description: 'Contrats d\'entretien, certificats, tournées.',
    tiles: [
      { key: 'pricing', title: 'Tarification', description: 'Zones, grille de prix, remises, options, durées d\'entretien', icon: 'Calculator', href: '/settings/pricing', adminOnly: true },
      { key: 'tournees', title: 'Tournées', description: 'Horizons, pauses, souplesse des RDV, figeage des journées', icon: 'Route', href: '/settings/tournees', adminOnly: true },
    ],
  },
  {
    key: 'communication',
    label: 'Communication',
    description: 'Emails, SMS et WhatsApp envoyés à vos clients.',
    tiles: [
      { key: 'emails', title: 'Emails', description: 'Expéditeur, adresse de réponse, domaine d\'envoi', icon: 'Mail', href: '/settings/emails', adminOnly: true, horsCrm: true },
      { key: 'sms', title: 'SMS & WhatsApp', description: 'Gabarits par campagne, rappel automatique des RDV', icon: 'MessageSquare', href: '/settings/sms', adminOnly: true },
    ],
  },
  {
    key: 'solaire',
    label: 'Solaire',
    description: 'Simulateur photovoltaïque et dossiers PV.',
    tiles: [
      { key: 'solaire', title: 'Calculateur photovoltaïque', description: 'Paramètres de calcul, grille de coûts, véhicule électrique, bibliothèque', icon: 'Sun', href: '/settings/solaire', adminOnly: true },
    ],
  },
  {
    key: 'thermique',
    label: 'Thermique',
    description: 'Études de déperditions et dimensionnement PAC.',
    tiles: [
      { key: 'thermique', title: 'Études de déperditions', description: 'Températures, ponts thermiques, calcul, bibliothèque de parois', icon: 'Thermometer', href: '/settings/thermique', adminOnly: true },
    ],
  },
  {
    // Module OPT-IN (settings.modules.maintenance === true), vendable seul : une org sans
    // CRM (settings.modules.crm === false) n'a que lui (+ tuiles `horsCrm` du socle).
    // Spec 2026-09-25-module-maintenance-taches-recurrentes-design.md.
    key: 'maintenance',
    label: 'Maintenance',
    description: "Tâches récurrentes par unité, borne d'atelier, traçabilité.",
    optIn: true,
    tiles: [
      { key: 'maintenance', title: 'Maintenance', description: 'Opérateurs et codes PIN, e-mail du soir, compte borne', icon: 'ClipboardCheck', href: '/settings/maintenance', adminOnly: true, horsCrm: true },
    ],
  },
];

/** Toutes les tuiles à plat, dans l'ordre des modules, chacune annotée de son module. */
export function tuilesParametrage() {
  return MODULES.flatMap((m) => m.tiles.map((t) => ({ ...t, module: m.key })));
}

/**
 * Un module est-il ouvert pour l'org ? Source : `core.organizations.settings.modules[key] === true`,
 * posé en base par nous (décision commerciale, pas un réglage de l'org_admin). Le socle est
 * toujours ouvert. Premier consommateur : l'envoi de la facture par e-mail (module
 * `communication`, Eric 2026-09-23) ; la sidebar et la page Paramètres s'y brancheront.
 * @param {object|null|undefined} settings
 * @param {string} key
 */
export function moduleActif(settings, key) {
  if (key === 'socle') return true;
  return settings?.modules?.[key] === true;
}

/**
 * Le CRM artisan (clients, planning, pipeline, entretiens…) est-il affiché ? Vrai par défaut :
 * seule une org qui n'a acheté qu'un module autonome (ex. Maintenance) porte
 * `settings.modules.crm === false` — sa sidebar et ses Paramètres se réduisent alors à ce module.
 * @param {object|null|undefined} settings
 */
export function crmActif(settings) {
  return settings?.modules?.crm !== false;
}

/**
 * Groupes de tuiles à afficher dans Paramètres pour une org et un rôle :
 * modules `optIn` seulement s'ils sont activés ; sans CRM, seules les tuiles `horsCrm`.
 * @param {object|null|undefined} settings
 * @param {{ isOrgAdmin: boolean }} ctx
 */
export function modulesVisibles(settings, { isOrgAdmin }) {
  const crm = crmActif(settings);
  return MODULES
    .filter((m) => !m.optIn || moduleActif(settings, m.key))
    .map((m) => ({
      ...m,
      tiles: m.tiles.filter((t) => (!t.adminOnly || isOrgAdmin) && (crm || t.horsCrm)),
    }))
    .filter((m) => m.tiles.length > 0);
}
