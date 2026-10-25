// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/catalogue/enrichissement.js — ne pas éditer.
// src/lib/catalogue/enrichissement.js
// Enrichissement web d'un article Majord'home — module PUR (aucun import), copié pour l'edge catalog-item-enrich par
// `npm run sync:tournee-engine`. Décision d'Eric (2026-10-25) : « l'enrichissement IA WEB doit se faire sur l'article
// pour pouvoir récupérer les photos etc ». Ici : le prompt, la lecture tolérante de la réponse de l'IA (rien n'est
// cru sur parole : URL publiques seulement, caractéristiques du schéma de la catégorie, converties selon leur type),
// la vérification d'un PDF, la fusion des caractéristiques acceptées. Le téléchargement et l'écriture sont dans l'edge.

const TEXTE_MAX = 200;

/**
 * true si l'URL vise un nom de domaine public en http(s) : pas d'adresse IP littérale, pas de nom local ou à une
 * étiquette, pas d'identifiants, pas de port exotique. Garde-fou avant tout téléchargement par l'edge.
 * @param {unknown} url
 * @returns {boolean}
 */
export function urlPublique(url) {
  if (typeof url !== 'string' || !url) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '80' && u.port !== '443') return false;
  const h = u.hostname.toLowerCase();
  if (!h || h.startsWith('[') || h.includes(':')) return false;
  if (h.endsWith('.')) return false; // « localhost. » contournerait les suffixes ci-dessous
  if (/^[0-9.]+$/.test(h)) return false;
  if (!h.includes('.')) return false;
  if (/(^|\.)(localhost|local|internal|localdomain|lan|home|intranet)$/.test(h)) return false;
  // services DNS de complaisance : le nom porte l'adresse visée (127.0.0.1.nip.io) ou pointe vers 127.0.0.1
  if (/(^|\.)(nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me|localhost\.run)$/.test(h)) return false;
  return true;
}

/** IPv4 en entier non signé, sinon null. */
function ipv4(ip) {
  const p = String(ip).split('.');
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return p.reduce((n, x) => n * 256 + Number(x), 0);
}

const PLAGES_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [ipv4(base), bits]);

/**
 * true si l'adresse résolue ne doit jamais être contactée par l'edge : bouclage, réseaux privés, link-local (métadonnées
 * cloud), CGNAT, multicast, réservées, IPv6 locales (::1, fc00::/7, fe80::/10) et IPv4 mappées. Illisible ⇒ vrai.
 * @param {string} ip
 * @returns {boolean}
 */
export function adresseIpPrivee(ip) {
  const s = String(ip || '').trim().toLowerCase();
  const n = ipv4(s);
  if (n != null) return PLAGES_V4.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
  if (!s.includes(':') || !/^[0-9a-f:.]+$/.test(s)) return true;
  const mappee = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappee) return adresseIpPrivee(mappee[1]);
  if (s === '::' || s === '::1') return true;
  const premier = parseInt(s.split(':')[0] || '0', 16);
  if ((premier & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((premier & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((premier & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/**
 * Champs à demander à l'IA depuis le schéma de la catégorie (src/shared/specs). Le groupe « documents » est écarté :
 * la fiche technique devient un document de l'article, pas un lien dans les caractéristiques.
 * @param {Array<{ key: string, label?: string, unit?: string, type?: string, options?: string[], group?: string }>} fields
 * @returns {Array<{ key: string, label: string, unit: string | null, type: string, options?: string[] }>}
 */
export function champsDuSchema(fields) {
  return (fields || []).filter((f) => f && f.key && f.group !== 'documents').map((f) => {
    const c = { key: f.key, label: f.label || f.key, unit: f.unit || null, type: f.type || 'text' };
    if (Array.isArray(f.options) && f.options.length) c.options = f.options.map(String);
    return c;
  });
}

/**
 * Prompt de recherche : l'article, ses références connues, les champs attendus, une sortie JSON stricte.
 * @param {{ name: string, brand?: string | null, gamme?: string | null, model_key?: string | null, references?: string[] }} article
 * @param {Array<{ key: string, label: string, unit: string | null, type: string, options?: string[] }>} champs
 * @returns {string}
 */
export function construirePromptEnrichissement(article, champs) {
  const ident = [`Libellé : ${article.name}`];
  if (article.brand) ident.push(`Marque : ${article.brand}`);
  if (article.gamme) ident.push(`Gamme : ${article.gamme}`);
  if (article.model_key) ident.push(`Modèle (clé normalisée) : ${article.model_key}`);
  const refs = (article.references || []).filter(Boolean);
  if (refs.length) ident.push(`Références fournisseur ou fabricant : ${refs.join(', ')}`);
  const lignes = champs.map((c) => {
    let l = `- ${c.key} : ${c.label}`;
    if (c.unit) l += ` (en ${c.unit})`;
    if (c.type === 'number') l += ' — nombre';
    if (c.type === 'boolean') l += ' — true ou false';
    if (c.options) l += ` — une valeur parmi : ${c.options.join(' | ')}`;
    return l;
  });
  return [
    'Tu complètes la fiche d\'un article du catalogue d\'un installateur en chauffage, climatisation et photovoltaïque.',
    'Cherche sur le web le produit EXACT décrit ci-dessous, de préférence sur le site du fabricant, puis chez un distributeur.',
    '',
    ...ident,
    '',
    'Trouve :',
    '1. photo_url : l\'URL directe d\'une image du produit (fichier .jpg, .png ou .webp), sans filigrane si possible.',
    '2. fiche_url : l\'URL directe de la fiche technique en PDF, en français de préférence.',
    '3. source_url : la page où tu as trouvé ces informations.',
    '4. specs : les caractéristiques suivantes, uniquement celles que tu as LUES sur une source (n\'invente rien, mets null sinon) :',
    ...(lignes.length ? lignes : ['(aucune caractéristique demandée)']),
    '',
    'Si tu n\'es pas sûr qu\'il s\'agit du même modèle, mets null plutôt qu\'une valeur d\'un modèle voisin.',
    'Termine ta réponse par un unique objet JSON, sans autre texte après :',
    '{"photo_url": string|null, "fiche_url": string|null, "source_url": string|null, "specs": {"<clé>": valeur|null}, "remarque": string|null}',
  ].join('\n');
}

/** Dernier objet JSON du texte : bloc ```json``` d'abord, sinon de la dernière « { » ouvrante équilibrée. */
function extraireJson(texte) {
  const bloc = [...String(texte || '').matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].pop();
  const candidats = [];
  if (bloc) candidats.push(bloc[1]);
  const t = String(texte || '');
  const fin = t.lastIndexOf('}');
  if (fin >= 0) {
    for (let i = t.lastIndexOf('{', fin); i >= 0; i = i > 0 ? t.lastIndexOf('{', i - 1) : -1) {
      candidats.push(t.slice(i, fin + 1));
      if (candidats.length > 40) break;
    }
  }
  for (const c of candidats) {
    try { const o = JSON.parse(c); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch { /* candidat suivant */ }
  }
  return null;
}

function convertir(champ, v) {
  if (v == null || v === '') return null;
  if (champ.type === 'number') {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const m = String(v).replace(/\s/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  if (champ.type === 'boolean') {
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (['true', 'oui', 'yes', '1'].includes(s)) return true;
    if (['false', 'non', 'no', '0'].includes(s)) return false;
    return null;
  }
  const s = String(v).trim().slice(0, TEXTE_MAX);
  if (!s) return null;
  if (champ.options) return champ.options.find((o) => o.toLowerCase() === s.toLowerCase()) ?? null;
  return s;
}

/**
 * Lecture tolérante de la réponse de l'IA. Ne lève jamais : `{ erreur: 'reponse_illisible' }` sans JSON lisible.
 * @param {string} texte
 * @param {Array<{ key: string, label: string, unit: string | null, type: string, options?: string[] }>} champs
 * @returns {{ erreur?: string, photo_url: string | null, fiche_url: string | null, source_url: string | null, specs: Record<string, string | number | boolean>, remarque: string | null }}
 */
export function lireProposition(texte, champs) {
  const vide = { photo_url: null, fiche_url: null, source_url: null, specs: {}, remarque: null };
  const o = extraireJson(texte);
  if (!o) return { ...vide, erreur: 'reponse_illisible' };
  const url = (v) => (urlPublique(v) ? v : null);
  /** @type {Record<string, string | number | boolean>} */
  const specs = {};
  const brutes = o.specs && typeof o.specs === 'object' ? o.specs : {};
  for (const c of champs) {
    const v = convertir(c, brutes[c.key]);
    if (v != null) specs[c.key] = v;
  }
  return {
    photo_url: url(o.photo_url), fiche_url: url(o.fiche_url), source_url: url(o.source_url), specs,
    remarque: typeof o.remarque === 'string' && o.remarque.trim() ? o.remarque.trim().slice(0, 500) : null,
  };
}

/**
 * true si les octets sont ceux d'un PDF (signature « %PDF- »).
 * @param {Uint8Array} octets
 * @returns {boolean}
 */
export function estPdf(octets) {
  if (!octets || octets.length < 5) return false;
  return String.fromCharCode(octets[0], octets[1], octets[2], octets[3], octets[4]) === '%PDF-';
}

/**
 * Nom de fichier lisible pour une fiche téléchargée : dernier segment du chemin décodé, extension .pdf garantie.
 * @param {string} url
 * @param {string} [defaut]
 * @returns {string}
 */
export function nomDeFichier(url, defaut = 'Fiche technique') {
  let seg = '';
  let parametres = false;
  try {
    const u = new URL(url);
    parametres = !!u.search;
    seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
  } catch { seg = ''; }
  seg = seg.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 120);
  // sans « .pdf », un segment suivi de paramètres nomme un script de téléchargement, pas le fichier
  if (!seg || (!/\.pdf$/i.test(seg) && (parametres || /\.[a-z0-9]{2,5}$/i.test(seg)))) seg = defaut;
  return /\.pdf$/i.test(seg) ? seg : `${seg}.pdf`;
}

/**
 * Caractéristiques de l'article après acceptation : les clés acceptées remplacent, les autres restent.
 * @param {Record<string, unknown>} canonical
 * @param {Record<string, unknown>} acceptees
 * @returns {Record<string, unknown>}
 */
export function fusionnerSpecs(canonical, acceptees) {
  return { ...(canonical || {}), ...(acceptees || {}) };
}

/**
 * Cases cochées d'office dans la validation : une valeur proposée pour un champ encore vide. Une valeur déjà saisie
 * n'est jamais remplacée sans geste.
 * @param {Record<string, unknown>} canonical
 * @param {Record<string, unknown>} proposees
 * @returns {Set<string>}
 */
export function cochesParDefaut(canonical, proposees) {
  const actuel = canonical || {};
  return new Set(Object.keys(proposees || {}).filter((k) => actuel[k] == null || actuel[k] === ''));
}
