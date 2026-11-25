// src/apps/artisan/pages/settings/communication/sms/ChampMessage.jsx
// ============================================================================
// Champ d'un message SMS / WhatsApp, à ÉTIQUETTES : le prénom, la date, le
// technicien… se glissent dans le texte (ou se posent d'un clic) depuis la rangée
// du haut. L'utilisateur ne tape et ne lit jamais d'accolades (Eric 2026-11-25).
//
// Ce qui est enregistré ne change pas : une chaîne où chaque étiquette vaut
// `{{name}}` — c'est elle que rendent `renderSmsTemplate` et l'edge d'envoi. Le
// champ n'est qu'un affichage de cette chaîne : `ecrire` (chaîne → DOM, découpage
// par `decouperMessage` du registre) et `lire` (DOM → chaîne) sont l'inverse l'un
// de l'autre, et le DOM n'est réécrit que si la chaîne reçue diffère de ce qu'il
// affiche (remise à zéro, texte suggéré, chargement) — jamais pendant la frappe.
//
// Même patron que les étiquettes de l'éditeur de mail (`mailing/editeur`) :
// insertion par le navigateur (annulable par Ctrl+Z), une étiquette s'efface d'un
// coup, coller et déposer = texte seul.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { GripVertical } from 'lucide-react';
import { decouperMessage } from '@/lib/smsCampaigns';
import { ecrire, lire, etiquette, etiquetteVoisine, suite, pointDeDepot } from './champMessageDom';
import { curseurApres, plageDans, placerCurseur } from '@apps/artisan/components/mailing/editeur/editeurDom';

/** Ce que porte une étiquette qu'on glisse ; `text/plain` l'accompagne pour que le navigateur montre où elle tombera. */
const MIME_ETIQUETTE = 'application/x-mdh-etiquette';

/**
 * @param {object} props
 * @param {string} props.value message enregistré (`{{name}}` pour une étiquette)
 * @param {(texte: string) => void} props.onChange
 * @param {Array<{ name: string, tag: string, label: string }>} props.variables étiquettes de la campagne (identité stable)
 * @param {Record<string, string>} [props.exemples] valeur d'exemple par étiquette, dite au survol
 * @param {string} props.labelId id du libellé du champ
 * @param {string} [props.placeholder]
 * @param {string} [props.hauteur] classe de hauteur minimale du texte
 */
export default function ChampMessage({ value, onChange, variables, exemples = {}, labelId, placeholder, hauteur = 'min-h-[5rem]' }) {
  const ref = useRef(null);
  const derniere = useRef(null); // dernière position du curseur dans ce champ, pour une étiquette posée d'un clic
  const valeur = useRef(value);
  valeur.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const tags = useMemo(() => Object.fromEntries(variables.map((v) => [v.name, v.tag || v.name])), [variables]);

  useEffect(() => {
    const ed = ref.current;
    if (ed && lire(ed) !== value) ecrire(ed, value, variables);
  }, [value, variables]);

  useEffect(() => {
    const suivre = () => {
      const plage = ref.current && plageDans(ref.current);
      if (plage) derniere.current = plage.cloneRange();
    };
    document.addEventListener('selectionchange', suivre);
    return () => document.removeEventListener('selectionchange', suivre);
  }, []);

  const emettre = useCallback(() => {
    const texte = lire(ref.current);
    if (texte !== valeur.current) onChangeRef.current(texte);
  }, []);

  /** Pose l'étiquette au curseur, puis une espace si la suite n'est ni une espace ni une virgule ou un point : le curseur ne reste pas collé contre elle. */
  const poser = useCallback((name) => {
    const ed = ref.current;
    if (!tags[name]) return;
    const el = etiquette(name, tags[name]);
    el.setAttribute('data-neuve', '');
    document.execCommand('insertHTML', false, el.outerHTML);
    // Le navigateur peut perdre l'attribut en route : une étiquette reste d'un seul bloc.
    ed.querySelectorAll('[data-var]:not([contenteditable="false"])').forEach((n) => {
      n.setAttribute('contenteditable', 'false');
      n.className = 'variable-mail';
    });
    // Chrome laisse le curseur DANS l'étiquette qu'il vient de poser (rien ne s'y écrit) : on le met juste après.
    // Mesuré le 2026-11-25 dans Chrome sans écran ; l'insertion reste annulable par Ctrl+Z.
    const neuve = ed.querySelector('[data-neuve]');
    if (neuve) {
      neuve.removeAttribute('data-neuve');
      curseurApres(neuve);
    }
    const plage = plageDans(ed);
    if (plage && !/[\s,.]/.test(suite(ed, plage) || '#')) document.execCommand('insertText', false, ' ');
    emettre();
  }, [tags, emettre]);

  /** Clic sur une étiquette : elle va là où était le curseur dans ce champ, à la fin s'il n'y est jamais venu. */
  const poserAuCurseur = useCallback((name) => {
    const ed = ref.current;
    if (!(document.activeElement === ed && plageDans(ed))) {
      ed.focus({ preventScroll: true });
      const r = derniere.current;
      if (r && ed.contains(r.startContainer) && ed.contains(r.endContainer)) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      } else placerCurseur(ed, 'fin');
    }
    poser(name);
  }, [poser]);

  const insererTexte = useCallback((texte) => {
    String(texte ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').split('\n').forEach((ligne, i) => {
      if (i) document.execCommand('insertLineBreak');
      if (ligne) document.execCommand('insertText', false, ligne);
    });
    emettre();
  }, [emettre]);

  const surTouche = (e) => {
    if (e.nativeEvent.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ['b', 'i', 'u'].includes(e.key.toLowerCase())) { e.preventDefault(); return; } // pas de mise en forme dans un SMS
    if (e.key === 'Enter') {
      e.preventDefault(); // un retour à la ligne, jamais un bloc du navigateur
      document.execCommand('insertLineBreak');
      emettre();
      return;
    }
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    const plage = plageDans(ref.current);
    if (!plage?.collapsed) return;
    const v = etiquetteVoisine(plage, e.key === 'Backspace' ? -1 : 1);
    if (v) { e.preventDefault(); v.remove(); emettre(); } // une étiquette s'efface d'un coup, comme un caractère
  };

  const surDepot = (e) => {
    e.preventDefault();
    const ed = ref.current;
    const name = e.dataTransfer?.getData(MIME_ETIQUETTE);
    const texte = name ? '' : e.dataTransfer?.getData('text/plain');
    if (name ? !tags[name] : !texte) return; // étiquette d'une autre campagne : elle n'existe pas ici
    const pos = pointDeDepot(ed, e.clientX, e.clientY);
    ed.focus({ preventScroll: true });
    if (pos) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(pos);
    } else placerCurseur(ed, 'fin');
    if (name) poser(name); else insererTexte(texte);
  };

  /** En quittant le champ : une information collée ou tapée entre accolades devient son étiquette. */
  const surSortie = () => {
    const ed = ref.current;
    const texte = lire(ed);
    const attendues = decouperMessage(texte, variables).filter((s) => s.type === 'variable').length;
    if (attendues === ed.querySelectorAll('[data-var]').length) return;
    ecrire(ed, texte, variables);
    emettre();
  };

  return (
    <div className="mdh-editeur-cadre rounded-md border border-secondary-300 bg-white transition-colors">
      {variables.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-t-md border-b border-secondary-200 bg-secondary-50 px-2 py-1.5">
          {variables.map((v) => (
            <span
              key={v.name}
              role="button"
              tabIndex={0}
              draggable
              title={exemples[v.name] ? `${v.label}. Exemple : ${exemples[v.name]}` : v.label}
              onDragStart={(e) => {
                e.dataTransfer.setData(MIME_ETIQUETTE, v.name);
                e.dataTransfer.setData('text/plain', `{{${v.name}}}`);
                // « copyMove » : le navigateur propose un déplacement quand du texte est sélectionné dans le champ, et refuserait le dépôt d'une copie seule.
                e.dataTransfer.effectAllowed = 'copyMove';
              }}
              onClick={() => poserAuCurseur(v.name)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); poserAuCurseur(v.name); } }}
              className="inline-flex cursor-grab select-none items-center gap-0.5 rounded-full bg-primary-50 py-0.5 pl-1 pr-2.5 text-xs font-medium text-primary-800 ring-1 ring-inset ring-primary-200 hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 active:cursor-grabbing"
            >
              <GripVertical className="h-3 w-3 text-primary-400" aria-hidden="true" />
              {v.tag || v.name}
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        {!value && placeholder && (
          <div aria-hidden="true" className="pointer-events-none absolute left-3 top-2 select-none text-sm text-secondary-400">
            {placeholder}
          </div>
        )}
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-labelledby={labelId}
          contentEditable
          suppressContentEditableWarning
          onInput={emettre}
          onKeyDown={surTouche}
          onPaste={(e) => { e.preventDefault(); insererTexte(e.clipboardData?.getData('text/plain') ?? ''); }}
          onDrop={surDepot}
          onDragStart={(e) => e.preventDefault()}
          onBlur={surSortie}
          className={`mdh-champ-message ${hauteur} px-3 py-2 text-sm leading-6 text-secondary-900 focus:outline-none`}
        />
      </div>
    </div>
  );
}
