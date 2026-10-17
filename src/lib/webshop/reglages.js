// src/lib/webshop/reglages.js
// Réglages de livraison / process du webshop — module PUR (aucun import). Valeurs org :
// core.organizations.settings.webshop (Settings → Socle → Webshop). ⚠ org_update_settings merge
// niveau 1 → toujours sauver l'objet `webshop` COMPLET.
// Copié tel quel par le site Mayer (`lib/boutique/reglages.js`) : ne rien importer ici.

/**
 * @typedef {{ code: string, libelle: string, adresse: string }} Depot
 * @typedef {{
 *   site_url: string,
 *   emails: { interne: string[] },
 *   depots: Depot[],
 *   palette: {
 *     transporteur: { nom: string, emails: string[], note: string },
 *     envoi_auto: boolean, heure_envoi: number,
 *     delai_fermeture_jours: number, horizon_semaines: number, ancre_cycle: string,
 *     capacite_emplacements: number, prix_emplacement_defaut_cents: number,
 *     tva_pct: number, max_emplacements_panier: number,
 *   },
 *   colis: {
 *     prestataire: { nom: string, mode: string, emails: string[], note: string },
 *     tva_pct: number, max_qty_ligne: number,
 *   },
 * }} WebshopConfig
 */

/** @param {any} o @returns {any} */
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/**
 * Défauts = comportement historique du webshop (fermeture J-2, 12 semaines, camion de 10, etc.).
 * Profondément figé : pour obtenir un objet modifiable, passer par `buildWebshopConfig`.
 * @type {Readonly<WebshopConfig>}
 */
export const WEBSHOP_REGLAGES_DEFAUT = deepFreeze({
  site_url: '',
  emails: { interne: [] },
  depots: [{ code: 'castanet', libelle: 'Dépôt Castanet-Tolosan', adresse: 'Castanet-Tolosan' }],
  palette: {
    transporteur: { nom: '', emails: [], note: '' },
    envoi_auto: true,
    heure_envoi: 18,
    delai_fermeture_jours: 2,
    horizon_semaines: 12,
    ancre_cycle: '2026-01-05',
    capacite_emplacements: 10,
    prix_emplacement_defaut_cents: 5500,
    tva_pct: 10,
    max_emplacements_panier: 10,
  },
  colis: {
    prestataire: { nom: '', mode: 'email', emails: [], note: '' },
    tva_pct: 20,
    max_qty_ligne: 20,
  },
});

/** Taux de TVA acceptés (en %). */
const TVA_VALIDES = [0, 5.5, 10, 20];

/** @param {any} v @returns {boolean} */
function estObjet(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Nombre fini à partir d'un nombre ou d'une chaîne non vide ; sinon NaN (null, '', booléens refusés).
 * @param {any} v @returns {number}
 */
function enNombre(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

/**
 * Entier dans [min, max], sinon `defaut`.
 * @param {any} v @param {number} min @param {number} max @param {number} defaut @returns {number}
 */
function entierBorne(v, min, max, defaut) {
  const n = enNombre(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : defaut;
}

/**
 * Nombre appartenant à `valides`, sinon `defaut`.
 * @param {any} v @param {number[]} valides @param {number} defaut @returns {number}
 */
function parmi(v, valides, defaut) {
  const n = enNombre(v);
  return valides.includes(n) ? n : defaut;
}

/**
 * Chaîne trimée ; non-chaîne → défaut.
 * @param {any} v @param {string} defaut @returns {string}
 */
function texte(v, defaut) {
  return typeof v === 'string' ? v.trim() : defaut;
}

/**
 * Booléen (accepte 'true' / 'false'), sinon défaut.
 * @param {any} v @param {boolean} defaut @returns {boolean}
 */
function booleen(v, defaut) {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return defaut;
}

/**
 * Date ISO `YYYY-MM-DD` réellement existante, sinon défaut.
 * @param {any} v @param {string} defaut @returns {string}
 */
function dateIso(v, defaut) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return defaut;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : defaut;
}

/**
 * Liste d'e-mails : non-chaînes et vides écartés, trim + minuscules. Le format n'est PAS contrôlé ici
 * (c'est le rôle de `validerWebshopReglages`, pour que l'écran puisse signaler la faute).
 * @param {any} v @returns {string[]}
 */
function listeEmails(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((e) => typeof e === 'string').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/**
 * Liste des dépôts : entrées sans `code` écartées ; libellé / adresse par repli ; vide → défaut.
 * @param {any} v @returns {Depot[]}
 */
function listeDepots(v) {
  const out = [];
  if (Array.isArray(v)) {
    for (const d of v) {
      if (!estObjet(d)) continue;
      const code = texte(d.code, '');
      if (!code) continue;
      out.push({
        code,
        libelle: texte(d.libelle, '') || `Dépôt ${code}`,
        adresse: texte(d.adresse, '') || code,
      });
    }
  }
  return out.length ? out : WEBSHOP_REGLAGES_DEFAUT.depots.map((d) => ({ ...d }));
}

/**
 * Construit la configuration webshop d'une org : fusion profonde défaut ← `settings.webshop`,
 * chaque valeur coercée au type du défaut, hors bornes → défaut. Renvoie TOUJOURS un objet neuf
 * (modifiable par l'écran), jamais le défaut figé.
 * @param {any} settings `core.organizations.settings` (ou null)
 * @returns {WebshopConfig}
 */
export function buildWebshopConfig(settings) {
  const D = WEBSHOP_REGLAGES_DEFAUT;
  const w = estObjet(settings?.webshop) ? settings.webshop : {};
  const emails = estObjet(w.emails) ? w.emails : {};
  const p = estObjet(w.palette) ? w.palette : {};
  const pt = estObjet(p.transporteur) ? p.transporteur : {};
  const c = estObjet(w.colis) ? w.colis : {};
  const cp = estObjet(c.prestataire) ? c.prestataire : {};

  const capacite = entierBorne(p.capacite_emplacements, 1, 40, D.palette.capacite_emplacements);

  return {
    site_url: texte(w.site_url, D.site_url),
    emails: { interne: listeEmails(emails.interne) },
    depots: listeDepots(w.depots),
    palette: {
      transporteur: {
        nom: texte(pt.nom, D.palette.transporteur.nom),
        emails: listeEmails(pt.emails),
        note: texte(pt.note, D.palette.transporteur.note),
      },
      envoi_auto: booleen(p.envoi_auto, D.palette.envoi_auto),
      heure_envoi: entierBorne(p.heure_envoi, 0, 23, D.palette.heure_envoi),
      delai_fermeture_jours: entierBorne(p.delai_fermeture_jours, 0, 14, D.palette.delai_fermeture_jours),
      horizon_semaines: entierBorne(p.horizon_semaines, 1, 26, D.palette.horizon_semaines),
      ancre_cycle: dateIso(p.ancre_cycle, D.palette.ancre_cycle),
      capacite_emplacements: capacite,
      prix_emplacement_defaut_cents: entierBorne(p.prix_emplacement_defaut_cents, 0, 10_000_000, D.palette.prix_emplacement_defaut_cents),
      tva_pct: parmi(p.tva_pct, TVA_VALIDES, D.palette.tva_pct),
      max_emplacements_panier: entierBorne(
        p.max_emplacements_panier, 1, capacite, Math.min(D.palette.max_emplacements_panier, capacite),
      ),
    },
    colis: {
      prestataire: {
        nom: texte(cp.nom, D.colis.prestataire.nom),
        mode: texte(cp.mode, D.colis.prestataire.mode) || D.colis.prestataire.mode,
        emails: listeEmails(cp.emails),
        note: texte(cp.note, D.colis.prestataire.note),
      },
      tva_pct: parmi(c.tva_pct, TVA_VALIDES, D.colis.tva_pct),
      max_qty_ligne: entierBorne(c.max_qty_ligne, 1, 100, D.colis.max_qty_ligne),
    },
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Erreurs bloquantes pour l'écran Settings : e-mail mal formé, `site_url` non https, codes de dépôt
 * en double. Un `site_url` vide est toléré (l'envoi automatique échoue alors en `site_url_missing`).
 * @param {WebshopConfig} cfg configuration issue de `buildWebshopConfig`
 * @returns {Array<{ champ: string, message: string }>}
 */
export function validerWebshopReglages(cfg) {
  /** @type {Array<{ champ: string, message: string }>} */
  const erreurs = [];
  const listes = [
    ['emails.interne', cfg?.emails?.interne],
    ['palette.transporteur.emails', cfg?.palette?.transporteur?.emails],
    ['colis.prestataire.emails', cfg?.colis?.prestataire?.emails],
  ];
  for (const [champ, liste] of listes) {
    const mauvais = (Array.isArray(liste) ? liste : []).filter((e) => !EMAIL_RE.test(e));
    if (mauvais.length) erreurs.push({ champ, message: `Adresse e-mail invalide : ${mauvais.join(', ')}` });
  }

  const url = cfg?.site_url;
  if (typeof url === 'string' && url !== '' && !/^https:\/\/\S+$/.test(url)) {
    erreurs.push({ champ: 'site_url', message: "L'adresse du site doit commencer par https://" });
  }

  const vus = new Set();
  const doublons = new Set();
  for (const d of Array.isArray(cfg?.depots) ? cfg.depots : []) {
    if (vus.has(d.code)) doublons.add(d.code);
    vus.add(d.code);
  }
  if (doublons.size) {
    erreurs.push({ champ: 'depots', message: `Code de dépôt en double : ${[...doublons].join(', ')}` });
  }
  return erreurs;
}

/**
 * Dépôt par code. Code inconnu → dépôt de repli construit depuis le code (jamais un dépôt inventé
 * ailleurs : le libellé et l'adresse restent le code lui-même).
 * @param {WebshopConfig} cfg
 * @param {string} code
 * @returns {Depot}
 */
export function depotParCode(cfg, code) {
  const d = (Array.isArray(cfg?.depots) ? cfg.depots : []).find((x) => x.code === code);
  return d ? { ...d } : { code, libelle: `Dépôt ${code}`, adresse: code };
}
