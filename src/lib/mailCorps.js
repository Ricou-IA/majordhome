// src/lib/mailCorps.js
// ============================================================================
// Format du texte d'un e-mail : SEULE définition de ce qui est enregistré dans
// `mail_campaigns.html_body` et de ce que l'éditeur affiche. Pas de HTML libre :
// paragraphes, retours à la ligne, gras, italique, listes, liens, titre, bouton,
// encadré et variables `{{NOM}}`, avec leurs styles en ligne déjà posés (une
// messagerie n'a pas de feuille de style).
//
// Le résultat part chez les clients et s'injecte dans un `contentEditable` : ce
// module est un ASSAINISSEUR. Tout ce qui n'est pas dans la liste est retiré
// (balises, attributs, styles, adresses autres que https / http / mailto / tel
// ou une variable seule). Il lit des chaînes avec un petit lecteur de balises,
// sans DOM, pour tourner sous `node --test` et dans une edge.
//
// Module PUR, copié pour Deno par `npm run sync:tournee-engine` (PARTAGES) —
// ne jamais éditer la copie. Spec : docs/superpowers/specs/2026-11-21-createur-
// mail-une-page-habillage-design.md § 5.2.
// ============================================================================
import { variablesDe } from './emailsAutomatiques.js';

/** Liste des `{{NOM}}` distincts d'un texte, dans l'ordre d'apparition (définie par le registre des e-mails). */
export { variablesDe };

const STYLE_TITRE = 'margin:24px 0 8px;font-size:18px;line-height:1.3;color:#0f172a';
const STYLE_LIEN = 'color:{{ACCENT_COLOR}}';
const STYLE_P_BOUTON = 'text-align:center;margin:28px 0';
const STYLE_BOUTON = 'background:{{ACCENT_COLOR}};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600';
const STYLE_ENCADRE = 'border-left:4px solid {{ACCENT_COLOR}};background:#f8fafc;padding:12px 16px;margin:16px 0';

const JETON_SEUL = /^\{\{[A-Za-z0-9_]+\}\}$/;
const RACINE_DE_JETONS = /^\s*(?:\{\{[A-Za-z0-9_]+\}\}\s*)+$/;
const PROFONDEUR_MAX = 64;

const VIDES = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr', 'keygen', 'frame']);
/** Éléments dont le contenu n'est pas du HTML : sautés jusqu'à leur fermeture. */
const TEXTE_BRUT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);
/** Éléments retirés avec tout leur contenu. */
const SUPPRIMES = new Set([...TEXTE_BRUT, ...[...VIDES].filter((v) => v !== 'br'), 'head', 'object', 'template', 'svg',
  'math', 'select', 'button', 'audio', 'video', 'canvas', 'map', 'applet', 'frameset', 'xml', 'picture', 'option', 'colgroup']);
/** Mise en forme tolérée à la lecture et retirée (le texte reste). Une balise à préfixe (`o:p` de Word) aussi. */
const DEROULES = new Set(['span', 'font', 'u', 's', 'small', 'sub', 'sup', 'mark', 'abbr', 'cite', 'code', 'del', 'ins',
  'q', 'time', 'label', 'big', 'strike', 'tt', 'kbd', 'var', 'samp', 'bdi', 'bdo', 'data', 'nobr']);
const EN_LIGNE = new Set(['strong', 'b', 'em', 'i', 'a', 'br']);
const TITRES = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
/** Ce qu'un texte peut contenir pour s'ouvrir dans l'éditeur (styles et attributs ignorés). */
const EDITABLES = new Set(['p', 'div', 'ul', 'ol', 'li', ...EN_LIGNE, ...TITRES, 'span', 'font', 'u', 's', 'small', 'sub', 'sup']);

const ENTITES = Object.assign(Object.create(null), {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  agrave: 'à', acirc: 'â', auml: 'ä', ccedil: 'ç', ugrave: 'ù', ucirc: 'û', uuml: 'ü', icirc: 'î', iuml: 'ï', ocirc: 'ô',
  ouml: 'ö', oelig: 'œ', aelig: 'æ', Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Agrave: 'À', Acirc: 'Â', Ccedil: 'Ç',
  Ocirc: 'Ô', Ucirc: 'Û', Icirc: 'Î', OElig: 'Œ', euro: '€', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  laquo: '«', raquo: '»', hellip: '…', mdash: '—', ndash: '–', deg: '°', copy: '©', reg: '®', trade: '™',
  times: '×', middot: '·', bull: '•', sup2: '²', thinsp: '\u2009', ensp: '\u2002', emsp: '\u2003',
});

// ── Lecture ──────────────────────────────────────────────────────────────────

/** Décode les entités connues et numériques ; une entité nommée inconnue reste telle quelle. */
function decoder(s) {
  return s.replace(/&(?:#[xX]([0-9a-fA-F]+);?|#(\d+);?|([A-Za-z][A-Za-z0-9]{1,31});)/g, (m, hex, dec, nom) => {
    if (nom) return nom in ENTITES ? ENTITES[nom] : m;
    const cp = parseInt(hex ?? dec, hex ? 16 : 10);
    if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) return '\ufffd';
    return String.fromCodePoint(cp);
  });
}

/**
 * Arbre tolérant : jamais d'exception, balises mal fermées refermées au mieux.
 * @param {string} html
 */
function analyser(html) {
  const racine = { nom: '#racine', attrs: Object.create(null), enfants: [] };
  const pile = [racine];
  const bas = html.replace(/[A-Z]+/g, (c) => c.toLowerCase()); // ASCII seul : même longueur, mêmes positions que `html`
  const n = html.length;
  let page = false;
  let i = 0;
  const haut = () => pile[pile.length - 1];
  const texte = (t) => { if (t) haut().enfants.push({ texte: decoder(t) }); };
  const fermerJusqua = (k) => { pile.length = k; };
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { texte(html.slice(i)); break; }
    texte(html.slice(i, lt));
    i = lt;
    if (bas.startsWith('<!--', i)) { const f = html.indexOf('-->', i + 4); i = f < 0 ? n : f + 3; continue; }
    if (bas.startsWith('<![cdata[', i)) { const f = html.indexOf(']]>', i); i = f < 0 ? n : f + 3; continue; }
    if (html[i + 1] === '!' || html[i + 1] === '?') {
      if (bas.startsWith('<!doctype', i) || bas.startsWith('<?xml', i)) page = true;
      const f = html.indexOf('>', i); i = f < 0 ? n : f + 1; continue;
    }
    const fin = /^<\/([a-z][^\s/>]*)/.exec(bas.slice(i, i + 64));
    if (fin) {
      const f = html.indexOf('>', i); i = f < 0 ? n : f + 1;
      for (let k = pile.length - 1; k > 0; k--) if (pile[k].nom === fin[1]) { fermerJusqua(k); break; }
      continue;
    }
    const debut = /^<([a-z][^\s/>]*)/.exec(bas.slice(i, i + 64));
    if (!debut) { texte('<'); i += 1; continue; }
    const nom = debut[1];
    const attrs = Object.create(null);
    let j = i + debut[0].length;
    while (j < n && html[j] !== '>') {
      if (/[\s/]/.test(html[j])) { j++; continue; }
      let k = j + 1;
      while (k < n && !/[\s/>=]/.test(html[k])) k++;
      const cle = bas.slice(j, k);
      j = k;
      while (j < n && /\s/.test(html[j])) j++;
      let val = '';
      if (html[j] === '=') {
        j++;
        while (j < n && /\s/.test(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") { const f = html.indexOf(q, j + 1); val = html.slice(j + 1, f < 0 ? n : f); j = f < 0 ? n : f + 1; } else {
          k = j; while (k < n && !/[\s>]/.test(html[k])) k++; val = html.slice(j, k); j = k;
        }
      }
      if (!(cle in attrs)) attrs[cle] = decoder(val);
    }
    i = j + 1;
    const el = { nom, attrs, enfants: [] };
    if (TEXTE_BRUT.has(nom)) {
      const f = bas.indexOf(`</${nom}`, i);
      const g = f < 0 ? -1 : html.indexOf('>', f);
      i = g < 0 ? n : g + 1;
      haut().enfants.push(el);
      continue;
    }
    // Un bloc qui s'ouvre referme le paragraphe (ou l'élément de liste) encore ouvert.
    if (!EN_LIGNE.has(nom) && !DEROULES.has(nom) && !nom.includes(':')) {
      for (let k = pile.length - 1; k > 0; k--) {
        const o = pile[k].nom;
        if (o === 'p' || (nom === 'li' && o === 'li')) { fermerJusqua(k); break; }
        if (!EN_LIGNE.has(o) && !DEROULES.has(o) && !o.includes(':')) break;
      }
    }
    haut().enfants.push(el);
    if (!VIDES.has(nom) && pile.length < PROFONDEUR_MAX) pile.push(el);
  }
  return { racine, page };
}

// ── Construction : arbre → blocs de la forme enregistrée ─────────────────────

const estTexte = (e) => 'texte' in e;
const jetonSeul = (v) => typeof v === 'string' && JETON_SEUL.test(v.trim());

/** Enfants utiles : mise en forme tolérée déroulée, retirés ôtés, étiquette de variable → `{{X}}`. */
function etendre(enfants, out = []) {
  for (const e of enfants) {
    if (estTexte(e)) out.push(e);
    else if (SUPPRIMES.has(e.nom)) continue;
    else if (e.nom === 'span' && jetonSeul(e.attrs['data-var'])) out.push({ texte: e.attrs['data-var'].trim() });
    else if (DEROULES.has(e.nom) || e.nom.includes(':')) etendre(e.enfants, out);
    else out.push(e);
  }
  return out;
}

/** Adresse acceptée (https, http, mailto, tel, ou une variable seule) ou `null`. */
function adresseSure(brut) {
  if (typeof brut !== 'string') return null;
  // Comme un navigateur : tabulations et retours retirés, blancs et caractères de contrôle rognés aux deux bouts.
  // eslint-disable-next-line no-control-regex
  const u = brut.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(u)) return null;
  return JETON_SEUL.test(u) || /^(https?|mailto|tel):/i.test(u) ? u : null;
}

const estBoutonA = (a) => 'data-bouton' in a.attrs || /background/i.test(a.attrs.style ?? '');

function brutEnLigne(noeuds, ctx, dansLien) {
  const out = [];
  let sep = false;
  const ajouter = (x) => {
    if (estTexte(x) && !/\S/.test(x.texte)) { out.push(x); return; }
    if (sep && out.length) out.push({ br: true });
    sep = false;
    out.push(x);
  };
  for (const e of etendre(noeuds)) {
    if (estTexte(e)) ajouter(e);
    else if (e.nom === 'br') { out.push({ br: true }); sep = false; } else if (e.nom === 'strong' || e.nom === 'b') ajouter({ fmt: 'strong', enfants: brutEnLigne(e.enfants, ctx, dansLien) });
    else if (e.nom === 'em' || e.nom === 'i') ajouter({ fmt: 'em', enfants: brutEnLigne(e.enfants, ctx, dansLien) });
    else if (e.nom === 'a') {
      const href = adresseSure(e.attrs.href);
      const enfants = brutEnLigne(e.enfants, ctx, true);
      if (href && !dansLien) ajouter({ lien: href, enfants }); else enfants.forEach(ajouter);
    } else {
      // Bloc imbriqué dans du texte : son contenu sur sa propre ligne.
      const contenu = e.nom === 'div' && jetonSeul(e.attrs['data-var-bloc'])
        ? [{ texte: e.attrs['data-var-bloc'].trim() }] : brutEnLigne(e.enfants, ctx, dansLien);
      sep = true; contenu.forEach(ajouter); sep = true;
    }
  }
  return out;
}

const aDuTexte = (noeuds) => noeuds.some((x) => (estTexte(x) ? /\S/.test(x.texte) : !x.br && aDuTexte(x.enfants)));

/** Mise en forme vide déroulée, textes voisins fusionnés, blancs réduits à une espace. */
function nettoyer(noeuds) {
  const plats = [];
  for (const x of noeuds) {
    if (x.br || estTexte(x)) { plats.push(x); continue; }
    const enfants = nettoyer(x.enfants);
    if (aDuTexte(enfants)) plats.push({ ...x, enfants }); else plats.push(...enfants);
  }
  const out = [];
  for (const x of plats) {
    const der = out[out.length - 1];
    if (estTexte(x) && der && estTexte(der)) out[out.length - 1] = { texte: der.texte + x.texte }; else out.push(estTexte(x) ? { texte: x.texte } : x);
  }
  // eslint-disable-next-line no-control-regex
  for (const x of out) if (estTexte(x)) x.texte = x.texte.replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, '').replace(/[ \t\n\r\f]+/g, ' ');
  return out.filter((x) => !estTexte(x) || x.texte !== '');
}

/** Blancs et retours retirés en début et fin de bloc, et autour de chaque retour à la ligne. */
function rogner(noeuds) {
  const feuilles = [];
  (function parcourir(liste) { for (const x of liste) (x.br || estTexte(x) ? feuilles.push(x) : parcourir(x.enfants)); })(noeuds);
  const retire = new Set();
  const rognerBout = (ordre, re) => {
    for (const f of ordre) {
      if (f.br) { retire.add(f); continue; }
      f.texte = f.texte.replace(re, '');
      if (f.texte) break;
      retire.add(f);
    }
  };
  rognerBout(feuilles, /^[ \u00a0]+/);
  rognerBout([...feuilles].reverse(), /[ \u00a0]+$/);
  // Autour d'un retour : on rogne de feuille en feuille tant qu'elles ne sont que des blancs,
  // quelle que soit la mise en forme qui les enveloppe (sinon un second passage rognerait encore).
  const rognerAutour = (k, pas, re) => {
    for (let j = k + pas; j >= 0 && j < feuilles.length && !feuilles[j].br; j += pas) {
      const f = feuilles[j];
      if (retire.has(f)) continue;
      f.texte = f.texte.replace(re, '');
      if (f.texte) break;
      retire.add(f);
    }
  };
  feuilles.forEach((f, k) => {
    if (!f.br || retire.has(f)) return;
    rognerAutour(k, -1, /[ \u00a0]+$/);
    rognerAutour(k, 1, /^[ \u00a0]+/);
  });
  const filtrer = (liste) => liste.filter((x) => !retire.has(x) && !(estTexte(x) && x.texte === ''))
    .map((x) => (x.br || estTexte(x) ? x : { ...x, enfants: filtrer(x.enfants) }));
  return filtrer(noeuds);
}

const enLigne = (noeuds, ctx) => rogner(nettoyer(brutEnLigne(noeuds, ctx, false)));
const texteDe = (noeuds) => noeuds.map((x) => (x.br ? '\n' : estTexte(x) ? x.texte : texteDe(x.enfants))).join('');

function paragrapheOuBouton(noeuds, ctx, sortie) {
  const utiles = etendre(noeuds).filter((e) => !estTexte(e) || /\S/.test(e.texte));
  if (utiles.length === 1 && utiles[0].nom === 'a' && estBoutonA(utiles[0])) {
    const a = utiles[0];
    const libelle = texteDe(enLigne(a.enfants, ctx)).replace(/\s+/g, ' ').trim();
    const href = adresseSure(a.attrs.href);
    if (!libelle) return;
    if (!href) sortie.push({ type: 'p', contenu: [{ texte: libelle }] });
    else if (ctx.sansElements) sortie.push({ type: 'p', contenu: [{ lien: href, enfants: [{ texte: libelle }] }] });
    else sortie.push({ type: 'bouton', href, libelle });
    return;
  }
  const contenu = enLigne(noeuds, ctx);
  if (contenu.length) sortie.push({ type: 'p', contenu });
}

function blocDe(e, ctx, sortie) {
  const { nom, attrs } = e;
  const style = attrs.style ?? '';
  if (nom === 'p' || nom === 'li') return paragrapheOuBouton(e.enfants, ctx, sortie);
  if (TITRES.has(nom)) {
    if (ctx.sansElements || (ctx.editeur && nom !== 'h2')) return paragrapheOuBouton(e.enfants, ctx, sortie);
    const contenu = enLigne(e.enfants, ctx);
    if (contenu.length) sortie.push({ type: 'titre', contenu });
    return;
  }
  if (nom === 'ul' || nom === 'ol') {
    const items = etendre(e.enfants).map((c) => (estTexte(c) || c.nom !== 'li' ? enLigne([c], ctx) : enLigne(c.enfants, ctx)))
      .filter((c) => c.length);
    if (items.length) sortie.push({ type: 'liste', ordonnee: nom === 'ol', items });
    return;
  }
  if (nom === 'div') {
    if (jetonSeul(attrs['data-var-bloc'])) return sortie.push({ type: 'bloc', jeton: attrs['data-var-bloc'].trim() });
    const contientDesBlocs = etendre(e.enfants).some((c) => !estTexte(c) && !EN_LIGNE.has(c.nom));
    const encadre = 'data-encadre' in attrs || (!contientDesBlocs && !ctx.editeur && /border|background|padding/i.test(style));
    if (!encadre) return contientDesBlocs ? blocsDe(e.enfants, ctx, sortie) : paragrapheOuBouton(e.enfants, ctx, sortie);
    const contenu = enLigne(e.enfants, ctx);
    if (contenu.length) sortie.push({ type: ctx.sansElements ? 'p' : 'encadre', contenu });
    return;
  }
  blocsDe(e.enfants, ctx, sortie); // conteneur transparent (body, table, blockquote…)
}

function blocsDe(enfants, ctx, sortie) {
  let flux = [];
  const vider = () => {
    if (!flux.length) return;
    const tout = flux.every(estTexte) ? flux.map((x) => x.texte).join('') : null;
    // Une variable posée seule à la racine reste nue (variable-bloc) ; du texte tapé à la racine devient un paragraphe.
    if (tout !== null && RACINE_DE_JETONS.test(tout)) tout.match(/\{\{[A-Za-z0-9_]+\}\}/g).forEach((jeton) => sortie.push({ type: 'bloc', jeton }));
    else paragrapheOuBouton(flux, ctx, sortie);
    flux = [];
  };
  for (const e of etendre(enfants)) {
    if (estTexte(e) || EN_LIGNE.has(e.nom)) flux.push(e);
    else { vider(); blocDe(e, ctx, sortie); }
  }
  vider();
  return sortie;
}

const construire = (html, ctx) => blocsDe(analyser(String(html ?? '')).racine.enfants, ctx, []);

// ── Écriture ─────────────────────────────────────────────────────────────────

const echapperAttr = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function echapperTexte(t) {
  return t.replace(/&([A-Za-z][A-Za-z0-9]{1,31};)?|[<>"\u00a0]/g, (m, nom) => {
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (m === '"') return '&quot;';
    if (m === '\u00a0') return '&nbsp;';
    if (nom && !(nom.slice(0, -1) in ENTITES)) return m; // entité inconnue : laissée telle quelle
    return `&amp;${nom ?? ''}`;
  });
}

function libelleDe(jeton, libelles) {
  const nom = jeton.slice(2, -2);
  const l = libelles ? (libelles[jeton] ?? libelles[nom]) : undefined;
  return typeof l === 'string' && l ? l : nom;
}

function ecrireTexte(t, mode) {
  if (!mode.editeur) return echapperTexte(t);
  return t.split(/(\{\{[A-Za-z0-9_]+\}\})/).map((morceau, k) => (k % 2
    ? `<span contenteditable="false" data-var="${morceau}" class="variable-mail">${echapperTexte(libelleDe(morceau, mode.libelles))}</span>`
    : echapperTexte(morceau))).join('');
}

function ecrireEnLigne(noeuds, mode) {
  return noeuds.map((x) => {
    if (x.br) return '<br>';
    if (estTexte(x)) return ecrireTexte(x.texte, mode);
    const dedans = ecrireEnLigne(x.enfants, mode);
    if (x.fmt) return `<${x.fmt}>${dedans}</${x.fmt}>`;
    return `<a href="${echapperAttr(x.lien)}"${mode.sansElements ? '' : ` style="${STYLE_LIEN}"`}>${dedans}</a>`;
  }).join('');
}

function ecrire(blocs, mode) {
  return blocs.map((b) => {
    if (b.type === 'p') return `<p>${ecrireEnLigne(b.contenu, mode)}</p>`;
    if (b.type === 'titre') return `<h2 style="${STYLE_TITRE}">${ecrireEnLigne(b.contenu, mode)}</h2>`;
    if (b.type === 'encadre') return `<div data-encadre style="${STYLE_ENCADRE}">${ecrireEnLigne(b.contenu, mode)}</div>`;
    if (b.type === 'liste') {
      const balise = b.ordonnee ? 'ol' : 'ul';
      return `<${balise}>${b.items.map((it) => `<li>${ecrireEnLigne(it, mode)}</li>`).join('')}</${balise}>`;
    }
    if (b.type === 'bouton') {
      return `<p style="${STYLE_P_BOUTON}"><a data-bouton href="${echapperAttr(b.href)}" style="${STYLE_BOUTON}">${ecrireTexte(b.libelle, mode)}</a></p>`;
    }
    return mode.editeur
      ? `<div contenteditable="false" data-var-bloc="${b.jeton}" class="variable-bloc">${echapperTexte(libelleDe(b.jeton, mode.libelles))}</div>`
      : b.jeton;
  }).join('');
}

// ── API ──────────────────────────────────────────────────────────────────────

/**
 * Vrai si le texte peut s'ouvrir dans l'éditeur : il ne contient que les éléments du format (styles et
 * attributs ignorés, `span` / `font` / `u` tolérés). Une page complète, une image, un tableau : faux.
 * @param {string | null | undefined} html
 * @returns {boolean}
 */
export function estEditable(html) {
  const { racine, page } = analyser(String(html ?? ''));
  if (page) return false;
  const ok = (e) => estTexte(e) || ((EDITABLES.has(e.nom) || e.nom.includes(':')) && e.enfants.every(ok));
  return racine.enfants.every(ok);
}

/**
 * Remet un texte dans la forme enregistrée : balises et attributs permis, styles reposés, tout le reste retiré.
 * `sansElements` (mails habillés par le site, qui ne remplace pas `{{ACCENT_COLOR}}`) : titre, bouton et
 * encadré deviennent des paragraphes, et un lien ne porte pas de couleur.
 * @param {string | null | undefined} html
 * @param {{ sansElements?: boolean }} [options]
 * @returns {string}
 */
export function normaliser(html, options = {}) {
  const sansElements = !!options?.sansElements;
  return ecrire(construire(html, { sansElements, editeur: false }), { sansElements, editeur: false });
}

/**
 * Balisage de l'éditeur : texte normalisé, variables en étiquettes non éditables (libellé d'artisan, sinon
 * le nom de la variable), variable-bloc sur sa propre ligne. Les libellés sont lus par `{{X}}` puis par `X`.
 * @param {string | null | undefined} html
 * @param {Record<string, string>} [libelles]
 * @returns {string}
 */
export function versEditeur(html, libelles = {}) {
  return ecrire(construire(html, { sansElements: false, editeur: false }), { sansElements: false, editeur: true, libelles });
}

/**
 * Inverse de `versEditeur`, sur le HTML du `contentEditable` (texte collé compris) : étiquettes → variables,
 * `div` de l'éditeur → paragraphes (seul `div[data-encadre]` est un encadré, seul `h2` un titre), puis `normaliser`.
 * @param {string | null | undefined} htmlDuDom
 * @param {{ sansElements?: boolean }} [options]
 * @returns {string}
 */
export function depuisEditeur(htmlDuDom, options = {}) {
  const sansElements = !!options?.sansElements;
  const brut = ecrire(construire(htmlDuDom, { sansElements, editeur: true }), { sansElements, editeur: false });
  return normaliser(brut, { sansElements });
}

/**
 * Texte seul (compteur de longueur, extrait) : un bloc ou un retour à la ligne par ligne, variables en clair.
 * @param {string | null | undefined} html
 * @returns {string}
 */
export function texteBrut(html) {
  const lignes = construire(html, { sansElements: false, editeur: false }).map((b) => {
    if (b.type === 'liste') return b.items.map(texteDe).join('\n');
    if (b.type === 'bouton') return b.libelle;
    if (b.type === 'bloc') return b.jeton;
    return texteDe(b.contenu);
  });
  return lignes.join('\n').replace(/\u00a0/g, ' ').trim();
}
