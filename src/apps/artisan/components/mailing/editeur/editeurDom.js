// src/apps/artisan/components/mailing/editeur/editeurDom.js
// ============================================================================
// Gestes de l'éditeur de mail sur le DOM du texte : déplacer, envelopper, poser
// le curseur. Aucune conversion ni aucun nettoyage ici (c'est `mailCorps.js`) :
// tout ce qui est créé l'est élément par élément, jamais par une chaîne.
// ============================================================================

const BLOCS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'UL', 'OL', 'LI']);
const EN_LIGNE = new Set(['#text', 'B', 'STRONG', 'I', 'EM', 'A', 'SPAN', 'BR', 'U', 'FONT']);
export const estElement = (n, attr) => n?.nodeType === 1 && n.hasAttribute(attr);
export const estEtiquette = (n) => estElement(n, 'data-var');
export const estVariableBloc = (n) => estElement(n, 'data-var-bloc');
export const estBouton = (n) => n?.nodeName === 'P' && !!n.querySelector('a[data-bouton]');
export const estFixe = (n) => estVariableBloc(n) || estBouton(n);
const estVide = (n) => n?.nodeName === 'P' && !n.textContent.trim() && !n.querySelector('[data-var], a');
const sansTexte = (n) => n.nodeType === 3 && !n.textContent.replace(/\u200b/g, '').length;
export const elementDe = (n) => (n?.nodeType === 1 ? n : n?.parentElement ?? null);
const br = () => document.createElement('br');

export function nouveauParagraphe() {
  const p = document.createElement('p');
  p.appendChild(br());
  return p;
}

/** Sélection courante, seulement si elle est dans le texte. */
export function plageDans(ed) {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  const r = sel.getRangeAt(0);
  return ed.contains(r.commonAncestorContainer) ? r : null;
}

export function placerCurseur(n, ou) {
  if (!n) return;
  const r = document.createRange();
  r.selectNodeContents(n);
  r.collapse(ou === 'debut');
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Curseur juste après ce nœud (une étiquette qu'on vient de poser : le curseur ne doit jamais rester dedans). */
export function curseurApres(n) {
  const r = document.createRange();
  r.setStartAfter(n);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Bloc du texte (enfant direct de l'éditeur) qui contient ce point. */
export function blocRacine(ed, n, offset = 0) {
  if (n === ed) return ed.childNodes[Math.min(offset, ed.childNodes.length - 1)] ?? null;
  while (n && n.parentNode !== ed) n = n.parentNode;
  return n ?? null;
}

/** Déplace des nœuds en gardant le curseur s'il était dans un texte déplacé (pas recréé). */
function avecCurseur(ed, faire, repli) {
  const r = plageDans(ed);
  const point = r && r.startContainer.nodeType === 3 ? [r.startContainer, r.startOffset] : null;
  faire();
  if (point && ed.contains(point[0])) {
    const n = document.createRange();
    n.setStart(point[0], Math.min(point[1], point[0].length));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(n);
  } else placerCurseur(repli(), 'fin');
}

/** Nœud juste avant (sens -1) ou après (+1) le curseur ; au bord d'un bloc du texte, le bloc voisin. */
export function voisin(ed, plage, sens) {
  let c = plage.startContainer;
  let o = plage.startOffset;
  if (c.nodeType === 3) {
    if (sens < 0 ? o > 0 : o < c.length) return c;
    o = [...c.parentNode.childNodes].indexOf(c) + (sens < 0 ? 0 : 1);
    c = c.parentNode;
  }
  for (;;) {
    let k = sens < 0 ? o - 1 : o;
    while (k >= 0 && k < c.childNodes.length && sansTexte(c.childNodes[k])) k += sens;
    if (c.childNodes[k]) return c.childNodes[k];
    if (c === ed || !c.parentNode) return null;
    if (BLOCS.has(c.nodeName)) return c.parentNode === ed ? (sens < 0 ? c.previousSibling : c.nextSibling) : null;
    o = [...c.parentNode.childNodes].indexOf(c) + (sens < 0 ? 0 : 1);
    c = c.parentNode;
  }
}

// ── Bouton seul dans son paragraphe ──────────────────────────────────────────
// Le texte enregistré (`paragrapheOuBouton` de mailCorps.js) ne voit un bouton que si le lien est le SEUL
// élément utile de son paragraphe, une fois déroulées les balises de mise en forme tolérées (`span`, `font`,
// `u`…) et les commentaires sautés. Il tolère à côté de lui un texte fait seulement de blancs au sens de
// JavaScript (`\s` : espace, tabulation, retour, U+00A0, U+FEFF, espaces fines…). Tout le reste en fait un
// simple lien : un `<br>`, un U+200B (qui n'est pas un blanc pour `\s`), un `<b>` ou `<em>` même vide.
// Sondé le 2026-11-22, voir le rapport de la tâche 8 (fix round 2).

const ZWSP = String.fromCharCode(0x200b);
/** Balises que le texte enregistré déroule (liste `DEROULES` de mailCorps.js), en majuscules comme le DOM. */
const DEROULEES = new Set(['SPAN', 'FONT', 'U', 'S', 'SMALL', 'SUB', 'SUP', 'MARK', 'ABBR', 'CITE', 'CODE', 'DEL', 'INS',
  'Q', 'TIME', 'LABEL', 'BIG', 'STRIKE', 'TT', 'KBD', 'VAR', 'SAMP', 'BDI', 'BDO', 'DATA', 'NOBR']);
const MISE_EN_FORME = new Set(['B', 'STRONG', 'I', 'EM']);

/** Nœud qui porte du contenu : une étiquette, ou un caractère qui n'est ni un blanc ni U+200B. */
function estUtile(n) {
  if (n.nodeType === 3) return n.textContent.split(ZWSP).join('').trim() !== '';
  if (n.nodeType !== 1) return false;
  return estEtiquette(n) || !!n.querySelector('[data-var]') || n.textContent.split(ZWSP).join('').trim() !== '';
}

/** Nœud que le texte enregistré laisse à côté d'un bouton sans en faire un lien. */
function estTolere(n) {
  if (n.nodeType === 8) return true; // commentaire
  if (n.nodeType === 3) return /^\s*$/.test(n.textContent);
  return n.nodeType === 1 && (DEROULEES.has(n.nodeName) || n.nodeName.includes(':')) && !estEtiquette(n)
    && [...n.childNodes].every(estTolere);
}

/**
 * Un bouton est seul dans son paragraphe, sinon le texte enregistré n'y voit plus qu'un lien. Ce qui a été
 * tapé (ou fusionné par un effacement) à côté de lui part dans un paragraphe avant ou après ; un reste sans
 * contenu que le texte enregistré ne tolère pas (`<br>` d'un Maj+Entrée, U+200B, gras vide) est retiré. Le
 * DOM n'est touché que s'il y a quelque chose à corriger ; le curseur reste dans le texte déplacé, sinon il
 * va dans le paragraphe qui a reçu ce texte.
 */
export function reparerBoutons(ed) {
  const utiles = (liste) => liste.some(estUtile);
  for (let bloc = ed.firstChild; bloc; bloc = bloc.nextSibling) {
    // Bouton dans un paragraphe, ou fusionné dans un titre / un encadré par un effacement (pas dans une liste).
    const a = bloc.nodeType === 1 && !['UL', 'OL'].includes(bloc.nodeName) && !estVariableBloc(bloc) ? bloc.querySelector('a[data-bouton]') : null;
    if (!a) continue;
    // Gras ou italique autour du bouton : le texte enregistré n'y verrait qu'un lien ; on retire l'enveloppe.
    if (a.parentNode !== bloc && MISE_EN_FORME.has(a.parentNode.nodeName)) {
      avecCurseur(ed, () => {
        for (let w = a.parentNode; w !== bloc && MISE_EN_FORME.has(w.nodeName); w = a.parentNode) w.replaceWith(...w.childNodes);
      }, () => a.closest('p') ?? bloc);
    }
    let porteur = a;
    while (porteur.parentNode !== bloc) porteur = porteur.parentNode;
    const avant = [];
    const apres = [];
    let passe = false;
    for (let n = bloc.firstChild; n; n = n.nextSibling) {
      if (n === porteur) passe = true;
      else (passe ? apres : avant).push(n);
    }
    const dansUnParagraphe = bloc.nodeName === 'P';
    // Côté sans contenu : on retire ce que le texte enregistré ne tolère pas (dans un titre ou un encadré, le
    // bouton en sort de toute façon : rien à retirer).
    const retrait = (cote) => (utiles(cote) ? [] : cote.filter((n) => !estTolere(n)));
    const aRetirer = dansUnParagraphe ? [...retrait(avant), ...retrait(apres)] : [];
    const deplacement = !dansUnParagraphe || utiles(avant) || utiles(apres);
    if (!deplacement && !aRetirer.length) continue;
    // Côté du curseur, pour le replacer dans le paragraphe qui reçoit le texte s'il n'était pas dans un texte.
    const r0 = plageDans(ed);
    let aGauche = false;
    try { aGauche = !!r0 && r0.comparePoint(porteur, 0) > 0; } catch { aGauche = false; }
    let pa = null;
    let suite = null;
    const r = bloc;
    avecCurseur(ed, () => {
      aRetirer.forEach((n) => n.remove());
      // Paragraphe : il reste celui du bouton, le texte voisin part dans des paragraphes avant / après.
      // Titre ou encadré : il garde ce qui précède, le bouton reprend son paragraphe, la suite un bloc du même genre.
      const bouton = dansUnParagraphe ? r : document.createElement('p');
      if (!dansUnParagraphe) { bouton.appendChild(porteur); ed.insertBefore(bouton, r.nextSibling); }
      if (dansUnParagraphe && utiles(avant)) {
        pa = document.createElement('p');
        avant.forEach((n) => pa.appendChild(n));
        ed.insertBefore(pa, r);
      }
      if (utiles(apres)) {
        suite = dansUnParagraphe ? document.createElement('p') : r.cloneNode(false);
        apres.forEach((n) => suite.appendChild(n));
        ed.insertBefore(suite, bouton.nextSibling);
      }
      if (!dansUnParagraphe && !utiles(avant)) r.remove();
      if (!dansUnParagraphe && utiles(avant)) pa = r;
    }, () => (aGauche ? pa : suite) ?? pa ?? suite ?? a.closest('p'));
    if (!dansUnParagraphe) bloc = a.closest('p'); // reprendre après le bouton déplacé
  }
}

/** Le texte commence et finit par un paragraphe, et deux blocs posés (bouton, information sur sa ligne) ne se touchent pas : le curseur peut toujours aller avant, entre et après eux. */
export function garantirParagraphes(ed) {
  reparerBoutons(ed);
  // Une étiquette insérée par le navigateur garde sa nature (il peut perdre l'attribut en route).
  ed.querySelectorAll('[data-var]:not([contenteditable="false"]), [data-var-bloc]:not([contenteditable="false"])').forEach((n) => {
    n.setAttribute('contenteditable', 'false');
    n.className = n.hasAttribute('data-var') ? 'variable-mail' : 'variable-bloc';
  });
  if (!ed.firstChild) ed.appendChild(nouveauParagraphe());
  if (estFixe(ed.firstChild)) ed.insertBefore(nouveauParagraphe(), ed.firstChild);
  const dernier = ed.lastChild;
  if (estFixe(dernier) || estElement(dernier, 'data-encadre')) ed.appendChild(nouveauParagraphe());
  [...ed.childNodes].forEach((n) => { if (estFixe(n) && estFixe(n.nextSibling)) ed.insertBefore(nouveauParagraphe(), n.nextSibling); });
}

/** Texte tapé à la racine (après « tout effacer ») : remis dans un paragraphe, curseur gardé. */
export function rangerTexteRacine(ed) {
  if (![...ed.childNodes].some((n) => EN_LIGNE.has(n.nodeName) && !sansTexte(n))) return;
  avecCurseur(ed, () => {
    let p = null;
    [...ed.childNodes].forEach((n) => {
      if (!EN_LIGNE.has(n.nodeName)) { p = null; return; }
      if (!p) { p = document.createElement('p'); ed.insertBefore(p, n); }
      p.appendChild(n);
    });
  }, () => ed.lastChild);
}

/** Pose un bloc après celui du curseur, ou à sa place s'il est un paragraphe vide. */
export function insererApres(ed, bloc, el, remplacerVide = true) {
  if (bloc && remplacerVide && estVide(bloc)) ed.replaceChild(el, bloc);
  else ed.insertBefore(el, bloc ? bloc.nextSibling : null);
}

/** Lignes d'un bloc pour l'encadré (nœuds déplacés, pas copiés). */
function lignesDe(b) {
  if (b.nodeType === 3) return [[b]];
  if (b.nodeName === 'UL' || b.nodeName === 'OL') return [...b.children].map((li) => [...li.childNodes]);
  return [[...b.childNodes]];
}

export function basculerEncadre(ed, plage) {
  const debut = blocRacine(ed, plage.startContainer, plage.startOffset);
  let fin = blocRacine(ed, plage.endContainer, plage.endOffset) ?? debut;
  if (!debut) return;
  // Triple clic : la sélection finit au tout début du paragraphe suivant, qui n'est pas sélectionné.
  if (fin !== debut && plage.endOffset === 0 && fin.previousSibling) fin = fin.previousSibling;
  if (debut === fin && estElement(debut, 'data-encadre')) {
    // Retour en paragraphes : une ligne de l'encadré = un paragraphe.
    const ps = [];
    let p = document.createElement('p');
    const pousser = () => { if (!p.firstChild) p.appendChild(br()); ps.push(p); p = document.createElement('p'); };
    [...debut.childNodes].forEach((n) => {
      if (n.nodeName === 'BR') pousser();
      else if (BLOCS.has(n.nodeName)) { if (p.firstChild) pousser(); [...n.childNodes].forEach((c) => p.appendChild(c)); pousser(); } else p.appendChild(n);
    });
    if (p.firstChild || !ps.length) pousser();
    avecCurseur(ed, () => debut.replaceWith(...ps), () => ps[ps.length - 1]);
    return;
  }
  const blocs = [];
  for (let n = debut; n; n = n.nextSibling) { blocs.push(n); if (n === fin) break; }
  const utiles = blocs.filter((b) => !estFixe(b) && !(b.nodeType === 3 && !b.textContent.trim()));
  if (!utiles.length) return;
  const div = document.createElement('div');
  div.setAttribute('data-encadre', '');
  avecCurseur(ed, () => {
    utiles.flatMap(lignesDe)
      .map((l) => l.filter((n, k) => !(n.nodeName === 'BR' && k === l.length - 1))) // retour final d'un paragraphe
      .filter((l, k, toutes) => l.length || toutes.length === 1)
      .forEach((l, k) => { if (k) div.appendChild(br()); l.forEach((n) => div.appendChild(n)); });
    if (!div.firstChild) div.appendChild(br());
    ed.insertBefore(div, utiles[0]);
    utiles.forEach((b) => b.remove());
  }, () => div);
}

/** Entrée sur une ligne vide à la fin d'un encadré : on en sort (vrai si fait). */
export function sortirEncadreParEntree(ed, plage) {
  const div = elementDe(plage.startContainer)?.closest('[data-encadre]');
  if (!div) return false;
  const reste = document.createRange();
  reste.setStart(plage.startContainer, plage.startOffset);
  reste.setEnd(div, div.childNodes.length);
  const frag = reste.cloneContents();
  if (frag.textContent.trim() || frag.querySelector('[data-var]')) return false;
  const avant = voisin(ed, plage, -1);
  if (avant?.nodeName !== 'BR' || !div.contains(avant)) return false;
  avant.remove();
  reste.deleteContents();
  if (!div.firstChild) div.appendChild(br());
  const p = nouveauParagraphe();
  div.after(p);
  placerCurseur(p, 'debut');
  return true;
}

/** Texte collé ou déposé : paragraphes (ligne vide entre deux) de lignes, sans caractère de contrôle. */
export function texteDeCollage(texte) {
  // eslint-disable-next-line no-control-regex
  const propre = String(texte ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n+$/, '');
  return propre ? propre.split(/\n[ \t]*\n+/).map((p) => p.split('\n')) : [];
}
