/**
 * ApercuMail.jsx — le mail tel qu'il arrivera
 * ============================================================================
 * De (expéditeur résolu par la règle de l'envoi, ou la raison du refus), Objet
 * (texte, jamais du balisage), « Exemple pour Jean Dupont », bascule ordinateur /
 * téléphone (375 px). Le HTML vient de `rendreApercu` (`src/lib/mailApercu.js`),
 * le même habillage que l'envoi, dans un cadre fermé (`sandbox=""` : ni script,
 * ni lien, ni formulaire). Rendu un court instant après la frappe : l'éditeur
 * n'est jamais touché par l'aperçu.
 * Grand écran : colonne collante. Écran étroit : sous les cartes, repliée derrière
 * « Voir l'aperçu ».
 * ============================================================================
 */
import { useMemo, useState } from 'react';
import { ChevronDown, Eye, Monitor, Smartphone } from 'lucide-react';
import { rendreApercu } from '@/lib/mailApercu';
import { ligneExpediteur } from '@/lib/mailPage';
import { useDebounce } from '@hooks/useDebounce';

function Bascule({ actif, onClick, icone: Icone, libelle }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
        actif ? 'bg-white text-secondary-900 shadow-sm' : 'text-secondary-500 hover:text-secondary-800'
      }`}
    >
      <Icone className="h-4 w-4" aria-hidden="true" />
      {libelle}
    </button>
  );
}

/**
 * @param {object} props
 * @param {Record<string, any> | null} props.campagne ligne enregistrée (clé, nature)
 * @param {string} props.objet
 * @param {string} props.corps
 * @param {Record<string, any> | null} props.reglages réglages de l'organisation
 * @param {string} props.nature
 * @param {import('react').ReactNode} [props.children] sous l'aperçu (lien « Modifier l'habillage » de la page du mail)
 */
export default function ApercuMail({ campagne, objet, corps, reglages, nature, children }) {
  const [telephone, setTelephone] = useState(false);
  const [ouvert, setOuvert] = useState(false);
  const objetDiffere = useDebounce(objet, 250);
  const corpsDiffere = useDebounce(corps, 250);

  const apercu = useMemo(
    () => rendreApercu({ campagne, objet: objetDiffere, corps: corpsDiffere, reglages }),
    [campagne, objetDiffere, corpsDiffere, reglages],
  );
  const de = useMemo(() => ligneExpediteur(reglages, nature), [reglages, nature]);

  return (
    <aside className="min-w-0 lg:sticky lg:top-28">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className="flex h-11 w-full items-center justify-between rounded-xl border border-secondary-200 bg-white px-4 text-sm font-medium text-secondary-800 shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 lg:hidden"
      >
        <span className="inline-flex items-center gap-2"><Eye className="h-4 w-4 text-secondary-500" aria-hidden="true" />{ouvert ? 'Masquer l’aperçu' : 'Voir l’aperçu'}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${ouvert ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      <div className={`${ouvert ? 'mt-3 block' : 'hidden'} overflow-hidden rounded-xl border border-secondary-200 bg-white shadow-card lg:mt-0 lg:block`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-secondary-100 px-5 py-3">
          <h2 className="text-base font-semibold text-secondary-900">Aperçu</h2>
          <div className="inline-flex rounded-lg bg-secondary-100 p-1">
            <Bascule actif={!telephone} onClick={() => setTelephone(false)} icone={Monitor} libelle="Ordinateur" />
            <Bascule actif={telephone} onClick={() => setTelephone(true)} icone={Smartphone} libelle="Téléphone" />
          </div>
        </div>

        <dl className="space-y-1.5 border-b border-secondary-100 px-5 py-3 text-sm">
          <div className="flex gap-3">
            <dt className="w-14 flex-shrink-0 text-secondary-500">De</dt>
            <dd className={`min-w-0 break-words ${de.refus ? 'text-amber-800' : 'text-secondary-800'}`}>{de.texte}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-14 flex-shrink-0 text-secondary-500">Objet</dt>
            <dd className="min-w-0 break-words font-medium text-secondary-900">
              {apercu.objet || <span className="font-normal italic text-secondary-400">Pas encore d’objet</span>}
            </dd>
          </div>
          <p className="pt-0.5 text-secondary-500">Exemple pour Jean Dupont</p>
          {apercu.habilleParLeSite && <p className="text-secondary-500">Cet e-mail est habillé par votre site.</p>}
        </dl>

        <div className="bg-secondary-100 px-3 py-4 sm:px-5">
          <iframe
            title="Aperçu du mail"
            sandbox=""
            srcDoc={apercu.html}
            className={`mx-auto block h-[60vh] min-h-[420px] rounded-md border border-secondary-200 bg-white lg:h-[calc(100vh-20rem)] ${
              telephone ? 'w-[375px] max-w-full' : 'w-full'
            }`}
          />
        </div>
      </div>
      {children}
    </aside>
  );
}
