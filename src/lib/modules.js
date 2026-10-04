// src/lib/modules.js
// ============================================================================
// Découpage de Majord'home en MODULES — le découpage COMMERCIAL (décision Eric,
// 2026-09-13) : un socle toujours inclus, puis des modules vendables. Module
// PUR (aucun import React) : testé par `node --test scripts/modules.test.mjs`.
//
// Il porte les tuiles de la page Paramètres (groupées par module) ET le CATALOGUE des
// modules activables par organisation (`core.organizations.settings.modules`), ouverts ou
// fermés depuis Baikal, la console d'administration (edge baikal-admin, spec
// 2026-09-26-baikal-admin-modules-majordhome-design.md). Un module fermé disparaît de la
// sidebar, des Paramètres, et ses routes renvoient à l'accueil (ModuleGate).
// Copié pour Deno par `npm run sync:tournee-engine` (_shared/modules.js).
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
      // L'expéditeur des e-mails sert à tous les modules qui écrivent (factures, e-mail du soir) :
      // socle, pas Communication.
      { key: 'emails', title: 'Emails', description: 'Expéditeur, adresse de réponse, domaine d\'envoi', icon: 'Mail', href: '/settings/emails', adminOnly: true, horsCrm: true },
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
      { key: 'fumisterie', title: 'Fumisterie', description: 'Finition par défaut, longueurs d\'éléments, fixations, règle de zone 1', icon: 'Flame', href: '/settings/fumisterie', adminOnly: true },
    ],
  },
  {
    key: 'communication',
    label: 'Communication',
    description: 'Emails, SMS et WhatsApp envoyés à vos clients.',
    tiles: [
      { key: 'sms', title: 'SMS & WhatsApp', description: 'Gabarits par campagne, rappel automatique des RDV', icon: 'MessageSquare', href: '/settings/sms', adminOnly: true },
      { key: 'telephonie', title: 'Agent téléphonique', description: 'Assistante vocale des appels non répondus', icon: 'Phone', href: '/settings/telephonie', adminOnly: true },
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
    // Tâches récurrentes (clé technique `maintenance`, vocabulaire réglable par org) —
    // vendable seul. Spec 2026-09-25-module-maintenance-taches-recurrentes-design.md.
    key: 'maintenance',
    label: 'Tâches récurrentes',
    description: "Tâches récurrentes par unité, borne d'atelier, traçabilité.",
    tiles: [
      { key: 'maintenance', title: 'Tâches récurrentes', description: 'Vocabulaire, opérateurs et codes PIN, e-mail du soir, compte borne', icon: 'ClipboardCheck', href: '/settings/maintenance', adminOnly: true, horsCrm: true },
    ],
  },
];

/** Toutes les tuiles à plat, dans l'ordre des modules, chacune annotée de son module. */
export function tuilesParametrage() {
  return MODULES.flatMap((m) => m.tiles.map((t) => ({ ...t, module: m.key })));
}

/**
 * Modules ACTIVABLES par organisation (décision commerciale, depuis Baikal — jamais par
 * l'org_admin du client). `parDefaut` = état sans drapeau explicite : les modules historiques
 * sont ouverts par défaut (rien ne change pour une org existante), les nouveaux sont fermés.
 * `accueil` = écran d'entrée du module (accueil d'une org sans CRM). Le socle n'est pas activable.
 */
export const CATALOGUE = [
  { key: 'crm', label: 'CRM artisan', description: 'Clients, planning, pipeline commercial, chantiers, tâches, territoire, mailing.', parDefaut: true, accueil: '/' },
  { key: 'entretiens', label: 'Entretiens & Contrats', description: "Contrats d'entretien, certificats, tournées, tarification.", parDefaut: true, accueil: '/entretiens' },
  { key: 'communication', label: 'Communication', description: 'SMS et WhatsApp, envoi des factures par e-mail.', parDefaut: false, accueil: null },
  { key: 'solaire', label: 'Solaire', description: 'Simulateur photovoltaïque et dossiers PV.', parDefaut: true, accueil: '/solaire' },
  { key: 'thermique', label: 'Thermique', description: 'Études de déperditions et dimensionnement PAC.', parDefaut: true, accueil: '/thermique' },
  { key: 'maintenance', label: 'Tâches récurrentes', description: "Tâches récurrentes par unité, borne d'atelier, traçabilité, e-mail du soir.", parDefaut: false, accueil: '/maintenance' },
];

const PAR_CLE = new Map(CATALOGUE.map((m) => [m.key, m]));

/**
 * Un module est-il ouvert pour l'org ? `settings.modules[key]` s'il est booléen, sinon le
 * `parDefaut` du catalogue. Socle toujours ouvert ; clé hors catalogue toujours fermée.
 * @param {object|null|undefined} settings
 * @param {string} key
 * @returns {boolean}
 */
export function moduleActif(settings, key) {
  if (key === 'socle') return true;
  const entree = PAR_CLE.get(key);
  if (!entree) return false;
  const v = settings?.modules?.[key];
  return typeof v === 'boolean' ? v : entree.parDefaut;
}

/**
 * Le CRM artisan est-il ouvert ? (org « tâches récurrentes seules » : non).
 * @param {object|null|undefined} settings
 * @returns {boolean}
 */
export function crmActif(settings) {
  return moduleActif(settings, 'crm');
}

/**
 * État effectif de chaque module du catalogue (défauts appliqués) — ce que Baikal affiche.
 * @param {object|null|undefined} settings
 * @returns {Record<string, boolean>}
 */
export function modulesEffectifs(settings) {
  return Object.fromEntries(CATALOGUE.map((m) => [m.key, moduleActif(settings, m.key)]));
}

/**
 * Valide un changement de modules reçu de Baikal : objet non vide, valeurs booléennes,
 * clés du catalogue uniquement.
 * @param {unknown} modules
 * @returns {{ ok: true, modules: Record<string, boolean> } | { ok: false, erreur: string, inconnues?: string[] }}
 */
export function validerModules(modules) {
  if (!modules || typeof modules !== 'object' || Array.isArray(modules)) return { ok: false, erreur: 'invalid_body' };
  const entrees = Object.entries(modules);
  if (entrees.length === 0) return { ok: false, erreur: 'invalid_body' };
  if (entrees.some(([, v]) => typeof v !== 'boolean')) return { ok: false, erreur: 'invalid_body' };
  const inconnues = entrees.map(([k]) => k).filter((k) => !PAR_CLE.has(k));
  if (inconnues.length) return { ok: false, erreur: 'unknown_module', inconnues };
  return { ok: true, modules: Object.fromEntries(entrees) };
}

/**
 * Accueil d'une org sans CRM : écran du premier module ouvert (ordre du catalogue),
 * sinon Paramètres.
 * @param {object|null|undefined} settings
 * @returns {string}
 */
export function accueilSansCrm(settings) {
  const m = CATALOGUE.find((x) => x.key !== 'crm' && x.accueil && moduleActif(settings, x.key));
  return m ? m.accueil : '/settings';
}

// Rattachement des routes artisan (chemins de routes.jsx) à leur module. Toute route non
// listée appartient au CRM. Le test scripts/modules.test.mjs refuse une route orpheline.
const ROUTES_PAR_MODULE = {
  socle: [
    'settings', 'settings/team', 'settings/permissions', 'settings/organization', 'settings/suppliers',
    'settings/equipements', 'settings/emails', 'settings/pennylane', 'settings/plan-comptable', 'profile',
  ],
  entretiens: [
    'contrats', 'entretiens', 'certificat/:interventionId', 'clients/:clientId/contrat/signer',
    'settings/pricing', 'settings/tournees', 'settings/fumisterie',
  ],
  communication: ['settings/sms', 'settings/telephonie'],
  solaire: ['solaire', 'solaire/autoconso', 'solaire/historique', 'settings/solaire'],
  thermique: ['thermique', 'thermique/historique', 'settings/thermique'],
  maintenance: ['maintenance', 'settings/maintenance'],
};
const MODULE_PAR_ROUTE = new Map(
  Object.entries(ROUTES_PAR_MODULE).flatMap(([module, chemins]) => chemins.map((c) => [c, module])),
);

/**
 * Module d'une route artisan (chemin tel que déclaré dans routes.jsx), `crm` par défaut.
 * @param {string} chemin
 * @returns {string}
 */
export function moduleDeRoute(chemin) {
  return MODULE_PAR_ROUTE.get(chemin) || 'crm';
}

/**
 * Groupes de tuiles à afficher dans Paramètres pour une org et un rôle : le socle, puis les
 * modules OUVERTS ; sans CRM, le socle se réduit à ses tuiles `horsCrm`.
 * @param {object|null|undefined} settings
 * @param {{ isOrgAdmin: boolean }} ctx
 */
export function modulesVisibles(settings, { isOrgAdmin }) {
  const crm = crmActif(settings);
  return MODULES
    .filter((m) => moduleActif(settings, m.key))
    .map((m) => ({
      ...m,
      tiles: m.tiles.filter((t) => (!t.adminOnly || isOrgAdmin) && (crm || m.key !== 'socle' || t.horsCrm)),
    }))
    .filter((m) => m.tiles.length > 0);
}
