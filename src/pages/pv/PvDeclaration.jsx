/** Ce que déclare l'installateur, en lecture : la réponse est écrite en toutes lettres. */
import { Check, Minus, X } from 'lucide-react';
import { PageEtape } from '../public/pageUi';

/** Habillage de la réponse : une icône et le mot, la couleur ne porte rien seule. */
const HABILLAGE = {
  oui: { Icone: Check, classe: 'bg-secondary-100 text-secondary-900' },
  non: { Icone: X, classe: 'bg-amber-100 text-amber-950' },
  'sans objet': { Icone: Minus, classe: 'bg-secondary-50 text-secondary-600' },
};

function Reponse({ reponse }) {
  const texte = String(reponse ?? '');
  const h = HABILLAGE[texte.toLowerCase()] || { Icone: null, classe: 'bg-secondary-100 text-secondary-900' };
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${h.classe}`}>
      {h.Icone && <h.Icone className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
      {texte.charAt(0).toUpperCase() + texte.slice(1)}
    </span>
  );
}

export default function PvDeclaration({ numero, declaration, observation }) {
  if (!declaration?.length) return null;
  return (
    <PageEtape numero={numero} titre="Ce que déclare votre installateur">
      <ul className="divide-y divide-secondary-100 rounded-2xl border border-secondary-200 bg-white shadow-sm">
        {declaration.map((p, i) => (
          <li key={`${i}-${p.texte}`} className="flex items-start justify-between gap-4 p-4">
            <span className="text-base text-secondary-800">{p.texte}</span>
            <Reponse reponse={p.reponse} />
          </li>
        ))}
      </ul>
      {observation && (
        <div className="mt-4 rounded-2xl border border-secondary-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-secondary-900">Observation de votre installateur</p>
          <p className="mt-1 whitespace-pre-line text-base text-secondary-800">{observation}</p>
        </div>
      )}
    </PageEtape>
  );
}
