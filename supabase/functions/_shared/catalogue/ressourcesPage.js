// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/catalogue/ressourcesPage.js — ne pas éditer.
// src/lib/catalogue/ressourcesPage.js
// Photo et documents (notice, fiche technique) d'une page produit de fabricant, lus dans son HTML — module PUR (aucun
// import), copié pour l'edge equipment-model-enrich par `npm run sync:tournee-engine`. La recherche web lit les pages
// converties en texte et y perd les photos rangées hors d'une balise d'image (champ caché, style CSS) et les documents
// servis par un bouton de script (`window.open('/…/download/3030/')`, vécu sur jolly-mec.it le 2026-11-11). L'edge
// télécharge la page trouvée et complète ce que la recherche n'a pas rapporté. Rien n'est cru sur parole : chaque
// fichier est ensuite vérifié (vraie image, vrai PDF) avant d'être gardé.

const EXT_IMAGE = /\.(jpe?g|png|webp)(\?|#|$)/i;
// icônes, logos, et pastilles de couleur / finition (jolly-mec.it : productsFeatures/colore-bianco.jpg)
const IMAGE_ECARTEE = /favicon|apple-touch|icon|logo|sprite|flag|drapeau|placeholder|certification|badge|avatar|\/assets\/|features?\/|colou?re?[-_]|couleur|finition|swatch|texture|pietra/i;
const DOC_CANDIDAT = /\.pdf(\?|#|$)|\/download(s)?\/|[?&]download/i;
const DOC_ECARTE = /declaration|\bdop\b|etiquette|energy ?label|label energ|ecodesign|elimination|luminaire|garantie|mise.en.service|demande|conformite|certificat|commercial|brochure|catalogue|telecommande|telecomando|remote/;
const DOC_NOTICE = /manuel|notice|mode.d.emploi|instruction|manual|istruzioni|libretto|bedienungs/;
const DOC_FICHE = /fiche.(produit|technique)|scheda.tecnica|datasheet|data.sheet|technical.data|caracteristiques|scheda.prodotto/;

const ENTITES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î' };

/** Entités HTML usuelles décodées. */
function decoder(t) {
  return String(t || '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITES[e.toLowerCase()] ?? m;
  });
}

/** Texte comparable : minuscules, sans accents, `_` et `-` comme espaces. */
function plat(t) {
  return decoder(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_-]+/g, ' ');
}

/** Adresse absolue http(s), sinon null. */
function absolue(u, base) {
  try {
    const url = new URL(decoder(u).trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}

/** Texte d'un fragment HTML (balises retirées, espaces réduits). */
function texte(fragment) {
  return decoder(String(fragment || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function rangPhoto(url, ogImage) {
  if (ogImage) return 0;
  const fichier = plat(url.split(/[?#]/)[0].split('/').pop() || '');
  if (/\bprod|product|packshot|detour/.test(fichier)) return 1;
  if (/\bamb|ambiance|situation|lifestyle|scene/.test(fichier)) return 3;
  return 2;
}

/** Libellé d'un lien : le titre (h1-h6) qu'il contient, sinon son texte. */
function libelleLien(html, debut) {
  const fin = html.indexOf('</a>', debut);
  const contenu = fin > debut ? html.slice(debut, Math.min(fin, debut + 1500)) : html.slice(debut, debut + 300);
  const titre = contenu.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  const fermeture = contenu.indexOf('>');
  return texte(titre ? titre[1] : contenu.slice(fermeture + 1));
}

/**
 * Photos (meilleures d'abord, 5 au plus) et premier document de chaque sorte (notice, fiche technique) d'une page HTML.
 * Ne lève jamais.
 * @param {string} html
 * @param {string} pageUrl adresse de la page (résolution des liens relatifs)
 * @returns {{ photos: string[], notice: { url: string, label: string } | null, fiche: { url: string, label: string } | null }}
 */
export function extraireRessourcesPage(html, pageUrl) {
  const vide = { photos: [], notice: null, fiche: null };
  const source = String(html || '');
  if (!source || absolue(pageUrl, undefined) == null) return vide;

  // Photos : og:image / twitter:image, puis toute valeur d'attribut ou url(...) CSS qui pointe une image
  const vues = new Map(); // url -> rang
  const ajouterPhoto = (brute, og = false) => {
    const url = absolue(brute, pageUrl);
    if (!url || !EXT_IMAGE.test(url) || IMAGE_ECARTEE.test(url)) return;
    const rang = rangPhoto(url, og);
    if (!vues.has(url) || vues.get(url) > rang) vues.set(url, rang);
  };
  for (const m of source.matchAll(/<meta[^>]+(?:og:image|twitter:image)[^>]*>/gi)) {
    const c = m[0].match(/content=["']([^"']+)["']/i);
    if (c) ajouterPhoto(c[1], true);
  }
  for (const m of source.matchAll(/(?:src|data-[a-z-]+|value|content|href|srcset)=["']([^"']+)["']/gi)) ajouterPhoto(m[1].split(/[\s,]+/)[0]);
  for (const m of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) ajouterPhoto(m[1]);
  const ordre = [...vues.keys()];
  const photos = [...vues.entries()].sort((a, b) => a[1] - b[1] || ordre.indexOf(a[0]) - ordre.indexOf(b[0])).map(([u]) => u).slice(0, 5);

  // Documents : liens et boutons de script vers un PDF ou un téléchargement, classés par leur libellé
  let notice = null;
  let fiche = null;
  const motif = /(?:href|data-href|data-url)=["']([^"']+)["']|(?:window\.open|location\.href\s*=)\s*\(?\s*["']([^"']+)["']/gi;
  for (const m of source.matchAll(motif)) {
    const brute = m[1] || m[2];
    const url = absolue(brute, pageUrl);
    if (!url || !DOC_CANDIDAT.test(url)) continue;
    const debutBalise = source.lastIndexOf('<a', m.index);
    const label = debutBalise >= 0 && m.index - debutBalise < 400 ? libelleLien(source, debutBalise) : '';
    const cle = plat(`${label} ${url.split('/').pop()}`);
    if (DOC_ECARTE.test(cle)) continue;
    const doc = { url, label: label || decodeURIComponent(url.split('/').filter(Boolean).pop() || 'document') };
    if (!notice && DOC_NOTICE.test(cle)) notice = doc;
    else if (!fiche && DOC_FICHE.test(cle)) fiche = doc;
  }
  return { photos, notice, fiche };
}
