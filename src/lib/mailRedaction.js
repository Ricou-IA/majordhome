// src/lib/mailRedaction.js
// ============================================================================
// Rédaction assistée d'un e-mail : règles PURES. Quelles demandes sont valides,
// quelle consigne part au modèle de langage, quel format de réponse est exigé
// et, surtout, comment la réponse est CONTRÔLÉE avant que quoi que ce soit
// n'atteigne le texte de l'utilisateur. Ce module n'appelle jamais le modèle :
// c'est l'edge `mailing-rediger` qui le fait.
//
// Règle du produit : RIEN d'un client ou d'un prospect n'est envoyé au modèle.
// `construireConsigne` ne lit que ce que sa signature énumère (intention, objet
// et texte actuels, nature du mail, variables proposées, nom et site de
// l'entreprise, adresses autorisées) et demande des variables (`{{SALUTATION}}`)
// plutôt qu'un nom inventé.
//
// Le contrôle de la réponse (`lireReponse`) ne fait pas confiance au modèle :
// le texte repasse par `normaliser` (aucun second assainisseur), toute variable
// non proposée est retirée, tout lien dont l'adresse n'est ni dans la liste
// autorisée ni une variable proposée devient du texte simple. Une réponse
// inutilisable rend `null` : le texte de l'utilisateur reste en place.
//
// Module pur, copié pour Deno par `npm run sync:tournee-engine` (PARTAGES) —
// ne jamais éditer la copie. Spec : docs/superpowers/specs/2026-11-21-createur-
// mail-une-page-habillage-design.md § 5.5.
// ============================================================================
import { estEditable, normaliser, texteBrut } from './mailCorps.js';

/** Les cinq demandes possibles. */
export const CONSIGNES = Object.freeze(['rediger', 'court', 'chaleureux', 'reformuler', 'objets']);

/**
 * Code d'erreur → message affiché à l'artisan. Un code ajouté d'un côté s'ajoute de l'autre.
 * @type {Readonly<Record<string, string>>}
 */
export const REDACTION_CODES = Object.freeze({
  module_communication_inactif: 'Le module Communication n’est pas ouvert pour votre entreprise.',
  consigne_inconnue: 'Cette demande n’est pas reconnue. Choisissez l’une des propositions de la liste.',
  intention_requise: 'Dites en quelques mots ce que vous voulez écrire, puis relancez la rédaction.',
  texte_requis: 'Écrivez d’abord un texte : cette demande s’applique à un texte déjà écrit.',
  plafond_atteint: 'Vous avez atteint le nombre de rédactions autorisées pour aujourd’hui. Réessayez demain, ou écrivez le texte vous-même.',
  service_indisponible: 'La rédaction assistée ne répond pas pour le moment. Réessayez dans quelques minutes : votre texte n’a pas été modifié.',
  reponse_illisible: 'La proposition reçue n’était pas utilisable. Votre texte n’a pas été modifié : relancez la rédaction.',
});

/**
 * Message à afficher pour un code d'erreur (un code inconnu donne un message général).
 * @param {string | null | undefined} code
 * @returns {string}
 */
export function messageErreurRedaction(code) {
  return (code && REDACTION_CODES[code]) || 'La rédaction n’a pas abouti. Votre texte n’a pas été modifié : réessayez dans quelques minutes.';
}

const JETON = /^\{\{[A-Za-z0-9_]+\}\}$/;
const MAX_OBJETS = 3;

/** @param {unknown} v @returns {string} */
const texte = (v) => (typeof v === 'string' ? v : '');
/** Une ligne, sans caractère de contrôle ni blancs multiples. @param {unknown} v @returns {string} */
// eslint-disable-next-line no-control-regex
const uneLigne = (v) => texte(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Variables bien formées seulement. @param {unknown} liste @returns {string[]} */
const jetons = (liste) => [...new Set((Array.isArray(liste) ? liste : []).filter((j) => typeof j === 'string' && JETON.test(j.trim())).map((j) => j.trim()))];
/** Adresses : texte d'une ligne, sans doublon. @param {unknown} liste @returns {string[]} */
const listeAdresses = (liste) => [...new Set((Array.isArray(liste) ? liste : []).map(uneLigne).filter(Boolean))];

/** Entités que `normaliser` écrit dans un attribut, décodées (esperluette en dernier). @param {string} s @returns {string} */
const decoderAttr = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Un lien d'un texte normalisé : `<a … href="…">contenu</a>` (les attributs sont échappés, jamais de `>` dedans). */
const LIEN = /<a\s[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;

// ── Entrée ───────────────────────────────────────────────────────────────────

/**
 * Adresses que la réponse peut porter : toutes les valeurs `url` du catalogue d'adresses de l'entreprise
 * (parcours récursif de `mailing_resources`) et son site (`website_url`).
 * @param {{ website_url?: unknown, mailing_resources?: unknown } | null | undefined} reglages
 * @returns {string[]}
 */
export function adressesAutorisees(reglages) {
  /** @type {string[]} */
  const out = [];
  /** @param {unknown} noeud @param {number} profondeur */
  const parcourir = (noeud, profondeur) => {
    if (!noeud || typeof noeud !== 'object' || profondeur > 8) return;
    for (const [cle, v] of Object.entries(noeud)) {
      if (cle === 'url' && typeof v === 'string' && v.trim()) out.push(v.trim());
      else if (v && typeof v === 'object') parcourir(v, profondeur + 1);
    }
  };
  parcourir(reglages?.mailing_resources, 0);
  const site = reglages?.website_url;
  if (typeof site === 'string' && site.trim()) out.push(site.trim());
  return [...new Set(out)];
}

/**
 * Adresses de lien d'un texte (valeurs de `href`, telles qu'écrites, entités décodées), distinctes, dans
 * l'ordre. Lues sur le texte normalisé. Sert à garder le pied d'un texte (ex. le lien de désinscription)
 * quand la consigne retravaille un texte existant.
 * @param {string | null | undefined} html
 * @returns {string[]}
 */
export function adressesDuTexte(html) {
  const propre = normaliser(html);
  /** @type {string[]} */
  const out = [];
  for (const m of propre.matchAll(LIEN)) {
    const a = decoderAttr(m[1]).trim();
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

/**
 * Contrôle d'une demande avant tout appel : code d'erreur ou `null` si elle est valide.
 * `rediger` exige une intention ; les autres consignes exigent un texte.
 * @param {{ consigne?: unknown, intention?: unknown, corps?: unknown }} demande
 * @returns {string | null}
 */
export function validerDemande({ consigne, intention, corps } = {}) {
  if (typeof consigne !== 'string' || !CONSIGNES.includes(consigne)) return 'consigne_inconnue';
  if (consigne === 'rediger') return texte(intention).trim() ? null : 'intention_requise';
  return texteBrut(texte(corps)).trim() ? null : 'texte_requis';
}

// ── Consigne ─────────────────────────────────────────────────────────────────

/** @param {string} nature @returns {string} */
function natureDuMail(nature) {
  if (nature === 'sequence') return 'un e-mail envoyé automatiquement à un prospect qui vient de faire une demande';
  if (nature === 'automatique') return 'un e-mail envoyé automatiquement à un client à la suite d’une action (devis, rendez-vous, facture…)';
  if (nature === 'campagne') return 'un e-mail de campagne envoyé à une liste de clients ou de prospects';
  return 'un e-mail que l’entreprise envoie à ses clients ou à ses prospects';
}

const FORMAT = [
  'Le texte de l’e-mail est écrit avec ces seules balises, et aucune autre, sans aucun attribut de style :',
  '- <p>…</p> pour un paragraphe, <br> pour un retour à la ligne dans un paragraphe ;',
  '- <strong>…</strong> pour le gras, <em>…</em> pour l’italique ;',
  '- <ul><li>…</li></ul> ou <ol><li>…</li></ol> pour une liste ;',
  '- <a href="adresse">…</a> pour un lien ;',
  '- <h2>…</h2> pour un titre (rarement) ;',
  '- <p><a data-bouton href="adresse">Libellé</a></p> pour un bouton, au plus un ;',
  '- <div data-encadre>…</div> pour un encadré, au plus un.',
  'Pas de page complète, pas de tableau, pas d’image, pas de <html>, <body>, <style> ni <script>.',
].join('\n');

/**
 * Consigne envoyée au modèle de langage : `{ system, user }`. Déterministe. Ne lit QUE les champs listés :
 * rien d'un client ou d'un prospect n'y entre.
 * @param {{ consigne: string, intention?: string, objet?: string, corps?: string, nature?: string, variables?: string[],
 *   entreprise?: { nom?: string, site?: string }, adresses?: string[] }} entree
 * @returns {{ system: string, user: string }}
 * @throws {Error} `consigne_inconnue` si la consigne n'est pas l'une de `CONSIGNES` (l'appelant valide d'abord avec `validerDemande`)
 */
export function construireConsigne({ consigne, intention, objet, corps, nature, variables, entreprise, adresses } = {}) {
  if (typeof consigne !== 'string' || !CONSIGNES.includes(consigne)) throw new Error('consigne_inconnue');
  const nom = uneLigne(entreprise?.nom) || 'l’entreprise';
  const site = uneLigne(entreprise?.site);
  const vars = jetons(variables);
  const urls = listeAdresses(adresses);

  const system = [
    `Tu es l’assistant de rédaction de ${nom}, une entreprise d’artisans du bâtiment. Tu écris en français les e-mails que ${nom} envoie à ses clients et à ses prospects.`,
    '',
    `Cet e-mail est : ${natureDuMail(texte(nature))}.`,
    `Nom de l’entreprise : ${nom}.`,
    site ? `Site de l’entreprise : ${site}.` : 'Site de l’entreprise : aucun.',
    '',
    'Règles :',
    '- Écris en français, avec le vouvoiement (jamais de tutoiement).',
    '- Phrases courtes, mots simples, ton direct et sincère, comme un artisan qui écrit à son client.',
    '- Aucun superlatif, aucune promesse que tu ne peux pas vérifier, pas de série de points d’exclamation (un seul au plus).',
    '- Tu ne connais ni le nom, ni l’adresse, ni aucune information sur le destinataire : n’en invente aucune. Pour t’adresser à lui, utilise uniquement les variables proposées ci-dessous (par exemple {{SALUTATION}} pour la formule d’appel).',
    '- Utilise uniquement les variables de la liste, écrites exactement comme elles y figurent. N’en invente aucune.',
    '- Utilise uniquement les adresses de la liste pour un lien ou un bouton. N’invente jamais d’adresse, de numéro de téléphone ni d’adresse e-mail.',
    '- L’objet fait 50 caractères au plus, sans point d’exclamation.',
    '',
    FORMAT,
    '',
    vars.length ? `Variables proposées :\n${vars.map((v) => `- ${v}`).join('\n')}` : 'Variables proposées : aucune.',
    '',
    urls.length ? `Adresses autorisées :\n${urls.map((a) => `- ${a}`).join('\n')}` : 'Adresses autorisées : aucune (n’écris aucun lien).',
    '',
    'Réponds uniquement avec les trois champs demandés : "objet" (l’objet du mail), "objets" (trois autres propositions d’objet) et "corps" (le texte de l’e-mail avec les balises ci-dessus).',
  ].join('\n');

  const sujet = uneLigne(objet);
  // Forme montrée au modèle : sans style en ligne (il ne connaît ni les styles, ni `{{ACCENT_COLOR}}`) ; `data-bouton`
  // et `data-encadre` restent, `normaliser` repose les styles quand la réponse revient.
  const texteActuel = normaliser(texte(corps)).replace(/ style="[^"]*"/g, '');
  const but = uneLigne(intention);
  const existant = [
    `Objet actuel : ${sujet || '(aucun)'}`,
    'Texte actuel :',
    texteActuel || '(vide)',
  ].join('\n');
  const garder = 'Garde tels quels les liens et les variables déjà présents dans le texte (même adresse, même nom de variable) ; ne les déplace pas à la légère et n’en ajoute pas d’autres que ceux autorisés.';

  /** @type {Record<string, string[]>} */
  const demandes = {
    rediger: [
      'Rédige un e-mail complet à partir de l’intention ci-dessous : une formule d’appel avec la variable prévue, un texte court et utile, une formule de politesse simple.',
      'Remplis "objet" avec le meilleur objet et "objets" avec trois autres propositions.',
      but ? `Intention de l’artisan : ${but}` : '',
      texteActuel ? `\nÀ titre d’indication, texte déjà écrit (reprends-en l’esprit, tu peux le remplacer) :\n${texteActuel}` : '',
    ],
    court: [
      'Raccourcis le texte ci-dessous d’environ un tiers : garde le sens, les informations utiles et le ton, supprime les redites et les formules inutiles.',
      garder,
      'Remplis "objet" avec l’objet actuel, ou une version plus courte s’il dépasse 50 caractères ; laisse "objets" vide.',
      but ? `Précision de l’artisan : ${but}` : '',
      existant,
    ],
    chaleureux: [
      'Réécris le texte ci-dessous avec un ton plus chaleureux et plus humain, toujours en vouvoyant, sans longueur ajoutée ni exagération.',
      garder,
      'Remplis "objet" avec l’objet actuel, ou une version plus chaleureuse ; laisse "objets" vide.',
      but ? `Précision de l’artisan : ${but}` : '',
      existant,
    ],
    reformuler: [
      'Reformule le texte ci-dessous avec d’autres mots : même sens, mêmes informations, même longueur à peu près, meilleure fluidité.',
      garder,
      'Remplis "objet" avec l’objet actuel reformulé ; laisse "objets" vide.',
      but ? `Précision de l’artisan : ${but}` : '',
      existant,
    ],
    objets: [
      'Propose trois objets différents pour cet e-mail, chacun de 50 caractères au plus : un direct, un qui donne envie d’ouvrir, un qui annonce clairement le contenu.',
      'Remplis "objets" avec ces trois propositions, "objet" avec la meilleure, et laisse "corps" vide ("").',
      but ? `Précision de l’artisan : ${but}` : '',
      existant,
    ],
  };
  const user = demandes[consigne].filter((l) => l !== '').join('\n\n');
  return { system, user };
}

/**
 * Schéma de la réponse demandée au modèle (format strict). AUCUN type union ni `null` : l'API refuse un
 * schéma à trop de champs « valeur ou null ». Une valeur absente s'écrit `""` ou `[]`.
 */
export const SCHEMA_REDACTION = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['objet', 'objets', 'corps'],
  properties: {
    objet: { type: 'string', description: 'Objet de l’e-mail, 50 caractères au plus. Chaîne vide si non demandé.' },
    objets: { type: 'array', items: { type: 'string' }, description: 'Trois autres propositions d’objet. Liste vide si non demandé.' },
    corps: { type: 'string', description: 'Texte de l’e-mail avec les seules balises autorisées. Chaîne vide pour une demande d’objets.' },
  },
});

// ── Réponse ──────────────────────────────────────────────────────────────────

/** Objet ou texte JSON (clôture Markdown tolérée) → objet, ou `null`. @param {unknown} brut @returns {Record<string, unknown> | null} */
function lireObjet(brut) {
  let v = brut;
  if (typeof v === 'string') {
    const t = v.trim().replace(/^```[A-Za-z0-9_-]*[ \t]*\r?\n?/, '').replace(/\r?\n?```$/, '').trim();
    try { v = JSON.parse(t); } catch { return null; }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
}

/**
 * Variables d'un texte : une variable proposée, même écrite avec des espaces (`{{ SALUTATION }}`), est ramenée à sa forme
 * exacte (seule substituée à l'envoi) ; toute autre est retirée, espace et ponctuation voisines recollées.
 * @param {string} s
 * @param {Set<string>} permises
 * @returns {string}
 */
function retirerVariables(s, permises) {
  let retire = false;
  const sortie = s.replace(/(\s?)\{\{\s*([A-Za-z0-9_]+)\s*\}\}([,.]?)/g, (m, avant, nom, ponct) => {
    if (permises.has(`{{${nom}}}`)) return `${avant}{{${nom}}}${ponct}`;
    retire = true;
    return ponct || avant;
  });
  return retire ? sortie.replace(/[ \t]+([,.])/g, '$1') : sortie;
}

/** Objet de mail : texte seul, une ligne. @param {unknown} v @param {Set<string>} permises @returns {string} */
function objetPropre(v, permises) {
  const sans = retirerVariables(texte(v).replace(/<[^>]*>/g, ' '), permises)
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&amp;/g, '&');
  return uneLigne(sans);
}

/**
 * Lit et CONTRÔLE la réponse du modèle. Rend `{ objet, objets, corps }` nettoyé, ou `null` si elle est
 * inutilisable (le texte de l'utilisateur reste alors en place). Ne lève jamais.
 * - `corps` repasse par `normaliser` ; non éditable (page complète, tableau, image, script) ⇒ `null` ;
 * - une variable hors de `variables` est retirée (texte, objet, objets) ;
 * - un lien dont l'adresse n'est ni dans `adresses` (comparaison exacte après rognage) ni une variable
 *   seule de `variables` devient son texte (y compris `mailto:` et `tel:`) ;
 * - `objet` / `objets` : texte seul, sur une ligne, trois au plus ;
 * - consigne `objets` : `corps` vaut `''`, au moins un objet exigé ; `objet` exigé pour `rediger`.
 * @param {unknown} brut objet déjà lu, ou texte JSON
 * @param {{ consigne?: string, variables?: string[], adresses?: string[] }} contexte
 * @returns {{ objet: string, objets: string[], corps: string } | null}
 */
export function lireReponse(brut, contexte) {
  try {
    const { consigne, variables, adresses } = contexte ?? {};
    if (typeof consigne !== 'string' || !CONSIGNES.includes(consigne)) return null;
    const o = lireObjet(brut);
    if (!o) return null;
    const { objet: objetBrut, objets: objetsBrut, corps: corpsBrut } = o;
    if (typeof objetBrut !== 'string' || !Array.isArray(objetsBrut) || typeof corpsBrut !== 'string') return null;

    const permises = new Set(jetons(variables));
    const urls = new Set(listeAdresses(adresses));

    const objet = objetPropre(objetBrut, permises);
    const objets = objetsBrut.filter((x) => typeof x === 'string').map((x) => objetPropre(x, permises)).filter(Boolean).slice(0, MAX_OBJETS);

    if (consigne === 'objets') return objets.length ? { objet, objets, corps: '' } : null;
    if (consigne === 'rediger' && !objet) return null;

    if (!estEditable(corpsBrut)) return null;
    // Variables non proposées retirées AVANT `normaliser` : il repose lui-même `{{ACCENT_COLOR}}` dans les styles.
    const sansVariables = normaliser(retirerVariables(corpsBrut, permises));
    // Liens : une adresse hors liste devient son texte (le bouton redevient un paragraphe au second passage).
    const sansLienInconnu = sansVariables.replace(LIEN, (m, href, dedans) => {
      const a = decoderAttr(href).trim();
      return urls.has(a) || (JETON.test(a) && permises.has(a)) ? m : dedans;
    });
    const corps = normaliser(sansLienInconnu);
    return corps.trim() ? { objet, objets, corps } : null;
  } catch {
    return null;
  }
}
