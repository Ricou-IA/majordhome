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
      { key: 'team', title: 'Administration utilisateurs', description: 'Membres, rôles, profils et droits d\'accès, couleur planning, compétences', icon: 'Users', href: '/settings/team', adminOnly: true },
      { key: 'equipements', title: 'Équipements', description: 'Catégories et types d\'équipement du parc client', icon: 'Wrench', href: '/settings/equipements', adminOnly: true },
      // Ouverte au team_leader (Eric 2026-10-27) : visible dès que le rôle a le droit `articles.edit` (org_admin compris)
      { key: 'suppliers', title: 'Fournisseurs & catalogue', description: 'Fournisseurs et catalogues produits', icon: 'Truck', href: '/settings/suppliers', acces: { resource: 'articles', action: 'edit' } },
      { key: 'pennylane', title: 'Facturation', description: 'Numérotation, mentions et coordonnées bancaires des factures ; lien Pennylane et comptes de vente', icon: 'Receipt', href: '/settings/pennylane', adminOnly: true },
      // L'expéditeur des e-mails sert à tous les modules qui écrivent (factures, e-mail du soir) :
      // socle, pas Communication.
      { key: 'emails', title: 'Emails', description: 'Expéditeur, adresse de réponse, domaine d\'envoi', icon: 'Mail', href: '/settings/emails', adminOnly: true, horsCrm: true },
      { key: 'plan-comptable', title: 'Plan comptable', description: 'Les comptes de vente Pennylane utilisables dans Majord\'home', icon: 'BookOpen', href: '/settings/plan-comptable', adminOnly: true, si: 'pennylane' },
      { key: 'devis', title: 'Devis', description: 'Chapitres par type de projet, mentions et affichage du document', icon: 'FileSignature', href: '/settings/devis', adminOnly: true },
    ],
  },
  {
    // Boutique en ligne : module activable depuis le 2026-11-21 (il était dans le socle).
    key: 'webshop',
    label: 'Webshop',
    description: 'Commandes de la boutique en ligne, catalogue, livraisons.',
    tiles: [
      { key: 'webshop', title: 'Webshop', description: 'Livraison palette, secteurs, colis, adresses de la boutique', icon: 'ShoppingCart', href: '/settings/webshop', adminOnly: true },
    ],
  },
  {
    // Dimensionnement d'une climatisation (moteur src/lib/clim/) : module activable depuis le 2026-11-21.
    key: 'climatisation',
    label: 'Climatisation',
    description: "Dimensionnement d'une climatisation et devis proposé.",
    tiles: [
      { key: 'clim', title: 'Climatisation', description: 'Règles de dimensionnement : W/m², expositions, vitrage, multi-split, liaisons', icon: 'Snowflake', href: '/settings/clim', adminOnly: true },
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
    // Métré de fumisterie assisté (devis des poêles) : module activable depuis le 2026-11-21 (Eric : option payante).
    key: 'fumisterie',
    label: 'Fumisterie',
    description: 'Métré assisté des conduits dans les devis de poêle.',
    tiles: [
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
      { key: 'solaire', title: 'Calculateur photovoltaïque', description: 'Paramètres de calcul, grille de coûts, véhicule électrique, bibliothèque, démarches administratives', icon: 'Sun', href: '/settings/solaire', adminOnly: true },
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
  { key: 'crm', label: 'CRM artisan', description: 'Clients, planning, pipeline commercial, chantiers, territoire, mailing.', parDefaut: true, accueil: '/' },
  { key: 'entretiens', label: 'Entretiens & Contrats', description: "Contrats d'entretien, certificats, tournées, tarification.", parDefaut: true, accueil: '/entretiens' },
  { key: 'communication', label: 'Communication', description: 'SMS et WhatsApp, envoi des factures par e-mail.', parDefaut: false, accueil: null },
  { key: 'solaire', label: 'Solaire', description: 'Simulateur photovoltaïque et dossiers PV.', parDefaut: true, accueil: '/solaire' },
  { key: 'thermique', label: 'Thermique', description: 'Études de déperditions et dimensionnement PAC.', parDefaut: true, accueil: '/thermique' },
  // Sortis du socle le 2026-11-21 (ouverture d'une 2e entité) : fermés par défaut, ouverts par Baikal
  // pour les organisations qui s'en servaient déjà. Ils s'appuient sur le CRM (pipeline, devis).
  { key: 'webshop', label: 'Webshop', description: 'Commandes de la boutique en ligne, catalogue produits, tournées de livraison.', parDefaut: false, accueil: null },
  { key: 'climatisation', label: 'Climatisation', description: "Dimensionnement d'une climatisation et devis proposé.", parDefaut: false, accueil: null },
  { key: 'fumisterie', label: 'Fumisterie', description: 'Métré assisté des conduits de fumée dans les devis de poêle.', parDefaut: false, accueil: null },
  // Écrans sortis du CRM le 2026-11-21 (Eric : « tout cela doit être en module »). Rien à régler dans un
  // groupe à eux : les deux réglages de GeoGrid vivent dans Organisation → Territoire, affichés si le module est ouvert.
  { key: 'cedants', label: 'Cédants', description: "Recherche d'entreprises à reprendre et suivi des dossiers.", parDefaut: false, accueil: null, sansReglage: true },
  { key: 'prospection', label: 'Prospection', description: 'Recherche de prospects professionnels et suivi commercial.', parDefaut: false, accueil: null, sansReglage: true },
  { key: 'geogrid', label: 'GeoGrid', description: 'Suivi du positionnement local sur Google Maps et Search Console.', parDefaut: false, accueil: null, sansReglage: true },
  { key: 'meta_ads', label: 'Meta Ads', description: 'Suivi du retour des campagnes publicitaires Meta.', parDefaut: false, accueil: null, sansReglage: true },
  { key: 'maintenance', label: 'Tâches récurrentes', description: "Tâches récurrentes par unité, borne d'atelier, traçabilité, e-mail du soir.", parDefaut: false, accueil: '/maintenance' },
  // Lien MonsieurDPE (fiche client) : rien à régler, donc pas de groupe de Paramètres (`sansReglage`).
  { key: 'dpe', label: 'MonsieurDPE', description: 'DPE du client retrouvé depuis sa fiche et analyse complète du logement.', parDefaut: false, accueil: null, sansReglage: true },
  // Assistant pièces (fiche appareil) : rien à régler côté Paramètres, donc pas de groupe (`sansReglage`).
  { key: 'assistant', label: 'Assistant pièces', description: "Recherche d'une pièce détachée sur le web depuis la fiche d'un appareil.", parDefaut: false, accueil: null, sansReglage: true },
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
    'settings/activite', 'settings/equipements', 'settings/emails', 'settings/pennylane', 'settings/plan-comptable', 'settings/devis', 'settings/projets', 'profile',
  ],
  entretiens: [
    'contrats', 'entretiens', 'certificat/:interventionId', 'clients/:clientId/contrat/signer',
    'settings/pricing', 'settings/tournees',
  ],
  communication: ['settings/sms', 'settings/telephonie'],
  solaire: ['solaire', 'solaire/autoconso', 'solaire/historique', 'settings/solaire'],
  thermique: ['thermique', 'thermique/historique', 'settings/thermique'],
  webshop: ['webshop', 'settings/webshop'],
  climatisation: ['clim', 'settings/clim'],
  fumisterie: ['settings/fumisterie'],
  cedants: ['cedants'],
  prospection: ['prospection'],
  geogrid: ['geogrid'],
  meta_ads: ['meta-ads'],
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
/**
 * Une tuile est visible pour l'org_admin ; une tuile `acces: { resource, action }` l'est aussi pour tout rôle qui a
 * ce droit (`can` = useCanAccess().can, absent ⇒ admin seul) ; une tuile sans `adminOnly` ni `acces` l'est pour tous.
 */
/** Conditions `si` d'une tuile : un réglage qui ne sert à rien pour cette organisation ne s'affiche pas. */
const CONDITIONS_TUILE = {
  // Le plan comptable ne sert qu'à une organisation reliée à Pennylane (lien posé dans la tuile Facturation).
  pennylane: (settings) => settings?.pennylane?.enabled === true,
};

function tuileVisible(t, { isOrgAdmin, can }, settings) {
  if (t.si && CONDITIONS_TUILE[t.si]?.(settings) !== true) return false;
  if (isOrgAdmin) return true;
  if (t.acces) return typeof can === 'function' && can(t.acces.resource, t.acces.action) === true;
  return !t.adminOnly;
}

export function modulesVisibles(settings, { isOrgAdmin, can }) {
  const crm = crmActif(settings);
  return MODULES
    .filter((m) => moduleActif(settings, m.key))
    .map((m) => ({
      ...m,
      tiles: m.tiles.filter((t) => tuileVisible(t, { isOrgAdmin, can }, settings) && (crm || m.key !== 'socle' || t.horsCrm)),
    }))
    .filter((m) => m.tiles.length > 0);
}

/** Le hub Paramètres s'ouvre dès qu'une tuile est visible pour ce rôle (lien du menu et route `/settings`). */
export function peutOuvrirParametres(settings, ctx) {
  return modulesVisibles(settings, ctx).length > 0;
}
