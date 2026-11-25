// src/apps/artisan/pages/settings/communication/sms/champMessageDom.js
// ============================================================================
// Champ d'un message SMS / WhatsApp à étiquettes (`ChampMessage`) : passage de la
// chaîne enregistrée au DOM du champ et retour, et lecture de ce qui entoure le
// curseur. `ecrire` et `lire` sont l'inverse l'un de l'autre : `lire(ecrire(t)) === t`.
// Le découpage du texte (quelle accolade est une étiquette) est celui du registre,
// `decouperMessage` de `src/lib/smsCampaigns.js` ; rien n'est décidé ici.
// ============================================================================
import { decouperMessage } from '@/lib/smsCampaigns';

const ZWSP = String.fromCharCode(0x200b);
const sansZwsp = (t) => t.split(ZWSP).join('');
const invisible = () => document.createTextNode(ZWSP);
export const estEtiquette = (n) => n?.nodeType === 1 && n.hasAttribute('data-var');

/** Étiquette du champ : un seul bloc que le curseur ne traverse pas, même habit que celles de l'éditeur de mail. */
export function etiquette(name, tag) {
  const el = document.createElement('span');
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('data-var', name);
  el.className = 'variable-mail';
  el.textContent = tag;
  return el;
}

/** Chaîne → DOM. Un caractère invisible borde une étiquette sans texte voisin : le curseur peut s'y poser. */
export function ecrire(ed, texte, variables) {
  const noeuds = [];
  decouperMessage(texte, variables).forEach((s) => {
    if (s.type === 'variable') {
      if (noeuds[noeuds.length - 1]?.nodeType !== 3) noeuds.push(invisible());
      noeuds.push(etiquette(s.name, s.tag));
      return;
    }
    s.texte.split('\n').forEach((ligne, i) => {
      if (i) noeuds.push(document.createElement('br'));
      if (ligne) noeuds.push(document.createTextNode(ligne));
    });
  });
  for (let i = noeuds.length - 1; i >= 0; i -= 1) {
    if (estEtiquette(noeuds[i]) && noeuds[i + 1]?.nodeType !== 3) noeuds.splice(i + 1, 0, invisible());
  }
  // Le dernier retour à la ligne d'un bloc ne fait pas de ligne : il en faut un de plus pour montrer une ligne vide finale.
  if (String(texte ?? '').endsWith('\n')) noeuds.push(document.createElement('br'));
  ed.replaceChildren(...noeuds);
}

/** DOM → chaîne : une étiquette vaut `{{name}}`, un retour à la ligne (`<br>` ou caractère) vaut « \n ». */
export function lire(ed) {
  let out = '';
  const marcher = (n) => {
    if (n.nodeType === 3) { out += sansZwsp(n.nodeValue); return; }
    if (n.nodeType !== 1) return;
    if (estEtiquette(n)) { out += `{{${n.getAttribute('data-var')}}}`; return; }
    if (n.nodeName === 'BR') { out += '\n'; return; }
    // Bloc posé par un navigateur (jamais par ce champ) : une ligne à lui.
    if ((n.nodeName === 'DIV' || n.nodeName === 'P') && out && !out.endsWith('\n')) out += '\n';
    n.childNodes.forEach(marcher);
  };
  ed.childNodes.forEach(marcher);
  // Symétrique d'`ecrire` : le retour final est celui que le navigateur pose pour garder la dernière ligne ouverte.
  return out.endsWith('\n') ? out.slice(0, -1) : out;
}

/** Étiquette collée au curseur (sens -1 : avant, +1 : après), caractères invisibles sautés. */
export function etiquetteVoisine(plage, sens) {
  let n = plage.startContainer;
  if (n.nodeType === 3) {
    const entre = sens < 0 ? n.nodeValue.slice(0, plage.startOffset) : n.nodeValue.slice(plage.startOffset);
    if (sansZwsp(entre) !== '') return null;
    n = sens < 0 ? n.previousSibling : n.nextSibling;
  } else {
    n = n.childNodes[sens < 0 ? plage.startOffset - 1 : plage.startOffset] ?? null;
  }
  while (n && n.nodeType === 3 && sansZwsp(n.nodeValue) === '') n = sens < 0 ? n.previousSibling : n.nextSibling;
  return estEtiquette(n) ? n : null;
}

/** Premier caractère après le curseur : « \n » pour un retour, « # » pour une étiquette, vide à la fin du message. */
export function suite(ed, plage) {
  const r = document.createRange();
  r.setStart(plage.endContainer, plage.endOffset);
  r.setEnd(ed, ed.childNodes.length);
  for (const n of r.cloneContents().childNodes) {
    if (n.nodeType === 3) {
      const t = sansZwsp(n.nodeValue);
      if (t) return t[0];
    } else return n.nodeName === 'BR' ? '\n' : '#';
  }
  return '';
}

/** Curseur juste après ce nœud. */
export function curseurApres(n) {
  const r = document.createRange();
  r.setStartAfter(n);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Point du texte sous la souris, au dépôt ; lâché sur une étiquette, le point est juste après elle. */
export function pointDeDepot(ed, x, y) {
  let pos = document.caretRangeFromPoint?.(x, y) ?? null;
  if (!pos) {
    const c = document.caretPositionFromPoint?.(x, y);
    if (c) { pos = document.createRange(); pos.setStart(c.offsetNode, c.offset); }
  }
  if (!pos || !ed.contains(pos.startContainer)) return null;
  const dans = (pos.startContainer.nodeType === 1 ? pos.startContainer : pos.startContainer.parentElement)?.closest('[data-var]');
  if (dans && dans !== ed && ed.contains(dans)) pos.setStartAfter(dans);
  pos.collapse(true);
  return pos;
}
