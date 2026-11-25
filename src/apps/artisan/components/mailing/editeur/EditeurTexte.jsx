/**
 * EditeurTexte — Mailing
 * ============================================================================
 * Le texte d'un mail comme dans un traitement de texte : gras, italique,
 * listes, lien, titre, bouton, encadré, et les informations que le mail
 * remplit tout seul (« Nom du client »…) posées comme des étiquettes. Le
 * format enregistré n'est jamais montré (spec 2026-11-21-createur-mail-une-
 * page-habillage-design.md § 5.3 ; repris de l'éditeur de Baikal).
 *
 * Conversions : TOUTES par `src/lib/mailCorps.js`. Le DOM n'est rempli que par
 * `versEditeur(valeur)` ; ce que l'éditeur ajoute lui-même (étiquette, lien,
 * bouton, encadré) est construit élément par élément, jamais par une chaîne.
 * `onChange` reçoit toujours `depuisEditeur(innerHTML)`, un texte normalisé.
 *
 * Le composant n'est pas contrôlé en continu : `valeur` n'est relue que
 * lorsque `version` change (ouverture, rédaction assistée, annulation), sinon
 * le curseur sauterait à chaque frappe.
 * ============================================================================
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { depuisEditeur, versEditeur } from '@lib/mailCorps';
import BarreOutils from './BarreOutils';
import FenetreLien from './FenetreLien';
import {
  basculerEncadre, blocRacine, curseurApres, elementDe, estBouton, estElement, estEtiquette, estFixe, estVariableBloc, garantirParagraphes,
  insererApres, nouveauParagraphe, placerCurseur, plageDans, rangerTexteRacine, reparerBoutons, sortirEncadreParEntree, texteDeCollage, voisin,
} from './editeurDom';

const TOUS = { titre: true, bouton: true, encadre: true };

/**
 * Gras / italique au curseur : le texte d'un bouton est enregistré sans mise en forme (elle disparaîtrait),
 * et un titre est déjà en gras (l'italique y est gardé). Rend la raison du refus, ou `null`.
 */
function raisonSansMiseEnForme(nom, dansBouton, dansTitre) {
  if (dansBouton) return nom === 'gras' ? 'Le texte d’un bouton ne se met pas en gras.' : 'Le texte d’un bouton ne se met pas en italique.';
  if (dansTitre && nom === 'gras') return 'Un titre est déjà en gras.';
  return null;
}

/** La sélection touche-t-elle un élément `sel` : un de ses bouts y est, ou elle le traverse ? */
function touche(ed, plage, sel) {
  if (!plage) return false;
  const dans = (n) => { const e = elementDe(n)?.closest(sel); return !!e && ed.contains(e); };
  if (dans(plage.startContainer) || dans(plage.endContainer)) return true;
  return !plage.collapsed && [...ed.querySelectorAll(sel)].some((e) => plage.intersectsNode(e));
}

function miseEnFormePossible(nom, ed, plage) {
  return !raisonSansMiseEnForme(nom, touche(ed, plage, 'a[data-bouton]'), touche(ed, plage, 'h2'));
}
const ETAT_VIDE = { gras: false, italique: false, puces: false, numeros: false, titre: false, encadre: false, toucheBouton: false, toucheTitre: false };

/**
 * @param {object} props
 * @param {string} props.valeur texte enregistré
 * @param {number | string} props.version relu dans l'éditeur quand elle change
 * @param {(html: string) => void} props.onChange texte normalisé
 * @param {Array<{ nom: string, libelle: string, bloc: boolean, lien: boolean, texte: boolean }>} [props.variables]
 *   `variablesProposees` : « Insérer » liste celles qui ont `texte` ou `bloc`, la fenêtre de lien celles qui ont `lien`
 * @param {{ titre: boolean, bouton: boolean, encadre: boolean }} [props.elements]
 * @param {boolean} [props.disabled]
 */
export default function EditeurTexte({ valeur, version, onChange, variables = [], elements = TOUS, disabled = false }) {
  const ref = useRef(null);
  const derniere = useRef(null); // dernière sélection connue dans le texte, pour la barre et la fenêtre
  const enPause = useRef(false); // collage en cours : une seule émission, à la fin
  const enComposition = useRef(false); // touche morte ou saisie composée en cours : on ne déplace rien
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [etat, setEtat] = useState(ETAT_VIDE);
  const [vide, setVide] = useState(true);
  const [fenetre, setFenetre] = useState(null); // demande ouverte de FenetreLien, + `cible` (lien modifié)

  const sansElements = !elements.titre && !elements.bouton && !elements.encadre;
  const libelles = useMemo(() => Object.fromEntries(variables.map((v) => [v.nom, v.libelle])), [variables]);
  const aInserer = useMemo(() => variables.filter((v) => v.texte || v.bloc), [variables]);
  const adressesProposees = useMemo(() => variables.filter((v) => v.lien), [variables]);
  const interdits = {
    gras: raisonSansMiseEnForme('gras', etat.toucheBouton, etat.toucheTitre),
    italique: raisonSansMiseEnForme('italique', etat.toucheBouton, etat.toucheTitre),
  };

  const lireEtat = useCallback(() => {
    const ed = ref.current;
    const plage = ed && plageDans(ed);
    if (!plage) return;
    const ancre = elementDe(plage.startContainer);
    const dans = (sel) => { const n = ancre?.closest(sel); return !!n && ed.contains(n); };
    const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
    const suivant = { gras: q('bold'), italique: q('italic'), puces: dans('ul'), numeros: dans('ol'), titre: dans('h2'), encadre: dans('[data-encadre]'),
      toucheBouton: touche(ed, plage, 'a[data-bouton]'), toucheTitre: touche(ed, plage, 'h2') };
    setEtat((avant) => (Object.keys(suivant).every((k) => avant[k] === suivant[k]) ? avant : suivant));
  }, []);

  const mesurerVide = useCallback((html) => {
    const ed = ref.current;
    setVide(html === '' && ed.children.length <= 1 && !ed.querySelector('[data-encadre], ul, ol, h2'));
  }, []);

  const emettre = useCallback(() => {
    const ed = ref.current;
    if (!ed || enPause.current) return;
    const html = depuisEditeur(ed.innerHTML, { sansElements });
    mesurerVide(html);
    onChangeRef.current?.(html);
  }, [sansElements, mesurerVide]);

  // Chargement : seule écriture de `innerHTML`, et seulement avec ce que rend `versEditeur`.
  useEffect(() => {
    const ed = ref.current;
    if (!ed) return;
    ed.innerHTML = versEditeur(valeur, libelles);
    garantirParagraphes(ed);
    derniere.current = null;
    mesurerVide(depuisEditeur(ed.innerHTML, { sansElements }));
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const suivre = () => {
      const plage = ref.current && plageDans(ref.current);
      if (!plage) return;
      derniere.current = plage.cloneRange();
      lireEtat();
    };
    document.addEventListener('selectionchange', suivre);
    return () => document.removeEventListener('selectionchange', suivre);
  }, [lireEtat]);

  /** Focus et sélection dans le texte : la sélection vivante si le texte a le focus, sinon la dernière connue. */
  const restaurer = useCallback(() => {
    const ed = ref.current;
    if (document.activeElement === ed && plageDans(ed)) return plageDans(ed);
    ed.focus({ preventScroll: true });
    const r = derniere.current;
    if (r && ed.contains(r.startContainer) && ed.contains(r.endContainer)) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } else if (!plageDans(ed)) {
      garantirParagraphes(ed);
      placerCurseur(ed.lastChild, 'fin');
    }
    return plageDans(ed);
  }, []);

  const executer = useCallback((nom, arg) => {
    restaurer();
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('defaultParagraphSeparator', false, 'p');
    document.execCommand(nom, false, arg);
  }, [restaurer]);

  const apres = useCallback(() => { garantirParagraphes(ref.current); emettre(); lireEtat(); }, [emettre, lireEtat]);

  /** Bloc posé par l'éditeur (bouton, information sur sa ligne), puis curseur sur la ligne suivante. */
  const poserBloc = useCallback((el) => {
    const ed = ref.current;
    const plage = restaurer();
    insererApres(ed, plage ? blocRacine(ed, plage.startContainer, plage.startOffset) : null, el);
    garantirParagraphes(ed);
    placerCurseur(el.nextSibling, 'debut');
    apres();
  }, [restaurer, apres]);

  const insererVariable = useCallback((v) => {
    const el = document.createElement(v.bloc ? 'div' : 'span');
    el.setAttribute('contenteditable', 'false');
    el.setAttribute(v.bloc ? 'data-var-bloc' : 'data-var', v.nom);
    el.className = v.bloc ? 'variable-bloc' : 'variable-mail';
    el.textContent = v.libelle;
    if (v.bloc) { poserBloc(el); return; }
    // L'étiquette est posée directement dans le texte, pas par `insertHTML` : le navigateur traite un élément
    // non modifiable comme un bloc. Mesuré dans Chrome le 2026-11-25 avec cet éditeur : en fin de paragraphe,
    // de titre ou d'encadré il l'envoyait dans un paragraphe à elle ; dans une liste il n'en gardait que le
    // libellé (du texte, plus une information) ; et il laissait le curseur DANS l'étiquette, où rien ne s'écrit,
    // pas même une seconde étiquette. Contrepartie : Ctrl+Z ne la retire pas, Retour arrière l'efface d'un coup.
    const ed = ref.current;
    const plage = restaurer();
    if (!plage) return;
    plage.deleteContents();
    // Ligne vide : son retour d'attente resterait devant l'étiquette, qui passerait à la ligne suivante.
    const hote = plage.startContainer;
    if (hote.nodeType === 1 && hote !== ed && hote.childNodes.length === 1 && hote.firstChild.nodeName === 'BR') hote.firstChild.remove();
    plage.insertNode(el);
    rangerTexteRacine(ed);
    curseurApres(el);
    // Une espace après l'étiquette, sauf devant une espace, une virgule ou un point : le curseur ne reste pas collé contre elle.
    // Pas dans le libellé d'un bouton : l'espace tomberait hors du bouton, et la suite du libellé avec elle.
    const ici = plageDans(ed);
    const suite = ici && voisin(ed, ici, 1);
    const car = suite?.nodeType === 3 ? suite.textContent[suite === ici.startContainer ? ici.startOffset : 0] : null;
    if (!el.closest('a[data-bouton]') && (!car || !/[\s,.]/.test(car))) document.execCommand('insertText', false, ' ');
    apres();
  }, [restaurer, poserBloc, apres]);

  /** Fenêtre de lien sur le lien ou le bouton sous le curseur, ou pour en poser un. */
  const ouvrirFenetre = useCallback((mode) => {
    const ed = ref.current;
    const plage = restaurer();
    const a = elementDe(plage?.startContainer)?.closest('a');
    const n = Date.now();
    if (a && ed.contains(a)) {
      const bouton = a.hasAttribute('data-bouton');
      // Texte rogné, comme celui que rend la fenêtre : changer seulement l'adresse ne touche pas au contenu du lien.
      const texte = a.textContent.replace(/\s+/g, ' ').trim();
      setFenetre({ n, mode: bouton ? 'bouton' : 'lien', existant: true, texte, adresse: a.getAttribute('href') || '', cible: a });
      return;
    }
    const texte = mode === 'lien' && plage && !plage.collapsed ? plage.toString().replace(/\s+/g, ' ').trim() : '';
    setFenetre({ n, mode, existant: false, texte, adresse: '', cible: null });
  }, [restaurer]);

  const validerFenetre = useCallback(({ texte, adresse }) => {
    const demande = fenetre;
    setFenetre(null);
    if (!demande) return;
    const a = demande.cible;
    if (a && ref.current.contains(a)) {
      a.setAttribute('href', adresse);
      if (texte !== demande.texte) a.textContent = texte; // texte inchangé : les étiquettes du libellé restent
      restaurer();
      apres();
      return;
    }
    const lien = document.createElement('a');
    lien.setAttribute('href', adresse);
    lien.textContent = texte;
    if (demande.mode === 'bouton') {
      lien.setAttribute('data-bouton', '');
      const p = document.createElement('p');
      p.appendChild(lien);
      poserBloc(p);
      return;
    }
    const plage = restaurer();
    // Texte sélectionné et laissé tel quel : le lien se pose dessus (mise en forme gardée).
    if (plage && !plage.collapsed && texte === demande.texte) executer('createLink', adresse);
    else executer('insertHTML', lien.outerHTML);
    apres();
  }, [fenetre, apres, poserBloc, restaurer, executer]);

  const retirerLien = useCallback(() => {
    const a = fenetre?.cible;
    setFenetre(null);
    if (!a || !ref.current.contains(a)) return;
    const parent = a.parentNode;
    const bouton = a.hasAttribute('data-bouton');
    while (a.firstChild) parent.insertBefore(a.firstChild, a);
    a.remove();
    if (bouton) parent.removeAttribute('style'); // le paragraphe du bouton redevient un paragraphe ordinaire
    restaurer();
    apres();
  }, [fenetre, restaurer, apres]);

  const action = useCallback((nom, arg) => {
    if (disabled) return;
    const ed = ref.current;
    if (nom === 'lien' || nom === 'bouton') { ouvrirFenetre(nom); return; }
    if (nom === 'inserer') { insererVariable(arg); return; }
    const plage = restaurer();
    const bloc = plage && blocRacine(ed, plage.startContainer, plage.startOffset);
    if (nom === 'gras' || nom === 'italique') {
      if (!miseEnFormePossible(nom, ed, plage)) return;
      executer(nom === 'gras' ? 'bold' : 'italic');
    } else if (bloc && !estFixe(bloc)) {
      // Un titre, une liste, un encadré ne s'emboîtent pas : on sort d'abord de l'encadré ou de la liste
      // (le texte enregistré les aplatirait sans le dire).
      if (estElement(bloc, 'data-encadre') && nom !== 'encadre') basculerEncadre(ed, plageDans(ed));
      if (bloc.nodeName === 'UL' && nom !== 'puces') executer('insertUnorderedList');
      else if (bloc.nodeName === 'OL' && nom !== 'numeros') executer('insertOrderedList');
      if (nom === 'puces') executer('insertUnorderedList');
      else if (nom === 'numeros') executer('insertOrderedList');
      else if (nom === 'encadre') basculerEncadre(ed, plageDans(ed));
      else {
        const h2 = elementDe(plageDans(ed)?.startContainer)?.closest('h2');
        executer('formatBlock', h2 && ed.contains(h2) ? 'p' : 'h2');
      }
    }
    apres();
  }, [disabled, executer, ouvrirFenetre, insererVariable, restaurer, apres]);

  const insererTexte = (texte) => {
    const plage = plageDans(ref.current);
    if (!plage) return;
    const ancre = elementDe(plage.startContainer);
    const dansBouton = !!ancre?.closest('a[data-bouton]');
    const entreParagraphes = dansBouton ? 'insertText' : ancre?.closest('[data-encadre]') ? 'insertLineBreak' : 'insertParagraph';
    enPause.current = true;
    try {
      texteDeCollage(texte).forEach((lignes, i) => {
        if (i) document.execCommand(entreParagraphes, false, ' ');
        lignes.forEach((ligne, j) => {
          if (j) document.execCommand(dansBouton ? 'insertText' : 'insertLineBreak', false, ' ');
          if (ligne) document.execCommand('insertText', false, ligne);
        });
      });
    } finally {
      enPause.current = false;
    }
    rangerTexteRacine(ref.current);
    apres();
  };

  const surTouche = (e) => {
    const ed = ref.current;
    const touche = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && ['b', 'i', 'u'].includes(touche)) {
      e.preventDefault(); // pas de souligné dans un mail : Ctrl+U ne fait rien
      if (touche !== 'u') action(touche === 'b' ? 'gras' : 'italique');
      return;
    }
    const plage = plageDans(ed);
    if (!plage) return;
    if ((e.key === 'Backspace' || e.key === 'Delete') && plage.collapsed) {
      // Une étiquette s'efface d'un coup, comme un seul caractère.
      const v = voisin(ed, plage, e.key === 'Backspace' ? -1 : 1);
      if (estEtiquette(v) || estVariableBloc(v)) { e.preventDefault(); v.remove(); apres(); return; }
      // Un bouton ne fusionne pas avec la ligne voisine (il deviendrait un simple lien) : « Retirer le bouton » le retire.
      if (v?.parentNode === ed && (estBouton(v) || estBouton(blocRacine(ed, plage.startContainer, plage.startOffset)))) e.preventDefault();
      return;
    }
    if (e.key !== 'Enter') return;
    const bloc = blocRacine(ed, plage.startContainer, plage.startOffset);
    if (estBouton(bloc)) {
      // Entrée (ou Maj+Entrée) dans un bouton : une ligne après lui, jamais un second bouton ni un retour à
      // la ligne à côté de lui (le texte enregistré n'y verrait plus qu'un lien).
      e.preventDefault();
      const p = nouveauParagraphe();
      insererApres(ed, bloc, p, false);
      placerCurseur(p, 'debut');
      apres();
    } else if (!e.shiftKey && elementDe(plage.startContainer)?.closest('[data-encadre]')) {
      // Dans un encadré : un retour à la ligne ; sur une ligne vide à la fin, on sort de l'encadré.
      e.preventDefault();
      if (!sortirEncadreParEntree(ed, plage)) document.execCommand('insertLineBreak');
      apres();
    }
  };

  const surDepot = (e) => {
    e.preventDefault(); // déposer = texte seul, comme coller
    const texte = !disabled && e.dataTransfer?.getData('text/plain');
    if (!texte) return;
    let pos = document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null;
    if (!pos && document.caretPositionFromPoint) {
      const c = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (c) { pos = document.createRange(); pos.setStart(c.offsetNode, c.offset); }
    }
    if (!pos || !ref.current.contains(pos.startContainer)) return;
    ref.current.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(pos);
    insererTexte(texte);
  };

  const surSaisie = (e) => {
    const ed = ref.current;
    if (enPause.current) return;
    // Pendant une composition (« ^ » puis « e »), déplacer le texte ferait avorter ou doubler la lettre :
    // les réparations attendent `compositionend`.
    if (!(enComposition.current || e?.nativeEvent?.isComposing)) {
      rangerTexteRacine(ed);
      reparerBoutons(ed); // du texte tapé à côté d'un bouton n'en fait pas un simple lien
    }
    if (!ed.firstChild) { ed.appendChild(nouveauParagraphe()); placerCurseur(ed.firstChild, 'debut'); }
    emettre();
  };

  return (
    <div className={`mdh-editeur-cadre rounded-lg border border-secondary-300 transition-colors ${disabled ? 'bg-secondary-50' : 'bg-white'}`}>
      <BarreOutils etat={etat} interdits={interdits} elements={elements} aInserer={aInserer} onAction={action} disabled={disabled} />
      <div className="relative">
        {vide && !disabled && (
          <div aria-hidden="true" className="pointer-events-none absolute left-4 top-3 select-none text-[15px] leading-6 text-secondary-400">
            Écrivez votre message…
          </div>
        )}
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label="Texte du mail"
          aria-readonly={disabled || undefined}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={surSaisie}
          onCompositionStart={() => { enComposition.current = true; }}
          onCompositionEnd={() => { enComposition.current = false; surSaisie(); }}
          onFocus={() => document.execCommand('defaultParagraphSeparator', false, 'p')}
          onKeyDown={disabled ? undefined : surTouche}
          onPaste={(e) => { e.preventDefault(); if (!disabled) insererTexte(e.clipboardData?.getData('text/plain') ?? ''); }}
          onDrop={surDepot}
          onDragStart={(e) => e.preventDefault()}
          onClick={(e) => { if (e.target.closest?.('a')) e.preventDefault(); }} // un lien du texte ne s'ouvre pas au clic
          className="mdh-editeur-mail min-h-[280px] px-4 py-3 text-[15px] leading-6 text-secondary-900 focus:outline-none"
        />
      </div>
      <FenetreLien
        demande={fenetre}
        adressesProposees={adressesProposees}
        onValider={validerFenetre}
        onRetirer={retirerLien}
        onFermer={() => { setFenetre(null); restaurer(); }}
      />
    </div>
  );
}

