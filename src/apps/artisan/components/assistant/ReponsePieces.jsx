/**
 * ReponsePieces.jsx — La réponse de l'assistant « Trouver une pièce » (une recherche terminée ou en échec)
 * ============================================================================
 * Tout texte vient de l'agent : il est affiché en nœud texte, jamais en HTML. Un lien n'est rendu que si
 * `lienSur` l'accepte (https). Un prix n'est « lu sur la page » que si `verifie === true`. Aucune couleur ne porte
 * seule l'information : l'état est écrit en toutes lettres. Aucune commande, aucun devis, aucun enregistrement.
 * ============================================================================
 */

import { ExternalLink } from 'lucide-react';
import { messageErreurAssistant, lienSur } from '@/lib/assistantPieces';
import { formatDateTimeFR } from '@/lib/utils';

const EURO = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** Un texte de l'agent, ou un tiret. */
const texte = (v) => (typeof v === 'string' && v.trim() ? v : '—');
const liste = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
const objets = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const prix = (v) => (typeof v === 'number' && Number.isFinite(v) ? EURO.format(v) : 'non communiqué');

function Titre({ children }) {
  return <h4 className="text-sm font-semibold text-secondary-900 mt-4 mb-1">{children}</h4>;
}

function Liste({ items }) {
  return (
    <ul className="list-disc pl-5 space-y-0.5 text-sm text-secondary-800">
      {items.map((t, i) => <li key={i} className="whitespace-pre-wrap">{t}</li>)}
    </ul>
  );
}

function LienOffre({ url }) {
  const lien = lienSur(url);
  if (!lien) return <span className="text-secondary-500">{texte(url)}</span>;
  return (
    <a href={lien.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-700 hover:underline">
      {lien.domaine}<ExternalLink className="w-3 h-3" aria-hidden="true" />
    </a>
  );
}

function TableauOffres({ offres, date }) {
  return (
    <>
      <Titre>Offres trouvées</Titre>
      <p className="text-xs text-secondary-500 mb-1">Recherche du {date}. Les prix peuvent avoir changé : vérifiez sur le site.</p>
      <div className="overflow-x-auto border border-secondary-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-secondary-50 text-left text-xs text-secondary-600">
            <tr>
              <th className="px-3 py-2 font-medium">Vendeur</th>
              <th className="px-3 py-2 font-medium">Référence</th>
              <th className="px-3 py-2 font-medium">Prix TTC</th>
              <th className="px-3 py-2 font-medium">Prix lu sur la page</th>
              <th className="px-3 py-2 font-medium">Disponibilité</th>
              <th className="px-3 py-2 font-medium">Lien</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {offres.map((o, i) => (
              <tr key={i} className="align-top">
                <td className="px-3 py-2 whitespace-pre-wrap">{texte(o.vendeur)}</td>
                <td className="px-3 py-2 font-mono text-xs whitespace-pre-wrap">{texte(o.reference)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{prix(o.prix_ttc)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{o.verifie === true ? 'oui' : 'non vérifié'}</td>
                <td className="px-3 py-2 whitespace-pre-wrap">{texte(o.disponibilite)}</td>
                <td className="px-3 py-2"><LienOffre url={o.url} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Structuree({ reponse, date }) {
  const pistes = liste(reponse.pistes);
  const pieces = objets(reponse.pieces);
  const offres = objets(reponse.offres);
  const verifications = liste(reponse.verifications);
  return (
    <div>
      {pistes.length > 0 && (
        <>
          <Titre>Pistes — à confirmer sur place</Titre>
          <Liste items={pistes} />
        </>
      )}
      <Titre>Appareil</Titre>
      <p className="text-sm text-secondary-800 whitespace-pre-wrap">{texte(reponse.appareil)}</p>
      {pieces.length > 0 && (
        <>
          <Titre>Pièces identifiées</Titre>
          <ul className="space-y-1.5 text-sm text-secondary-800">
            {pieces.map((p, i) => (
              <li key={i} className="border border-secondary-200 rounded-lg px-3 py-2">
                <p className="font-medium whitespace-pre-wrap">{texte(p.designation)} <span className="font-mono text-xs font-normal text-secondary-600">réf. {texte(p.reference)}</span></p>
                <p className="text-xs text-secondary-600">{p.type === 'origine' ? 'Pièce d’origine' : p.type === 'compatible' ? 'Pièce compatible' : 'Type non précisé'}</p>
                <p className="whitespace-pre-wrap">{texte(p.caracteristiques)}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      {offres.length > 0 && <TableauOffres offres={offres} date={date} />}
      {verifications.length > 0 && (
        <>
          <Titre>À vérifier avant de commander</Titre>
          <Liste items={verifications} />
        </>
      )}
    </div>
  );
}

/**
 * @param {{ recherche: { statut: string, reponse?: object|null, texte_brut?: string|null, erreur?: string|null,
 *   created_at?: string, finished_at?: string|null } }} p
 */
export default function ReponsePieces({ recherche }) {
  if (!recherche) return null;
  const date = formatDateTimeFR(recherche.finished_at || recherche.created_at);
  const brut = typeof recherche.texte_brut === 'string' && recherche.texte_brut.trim() ? recherche.texte_brut : null;

  if (recherche.statut === 'echec') {
    return (
      <div>
        <p className="text-sm font-medium text-secondary-900">Échec de la recherche</p>
        <p className="text-sm text-secondary-800 mt-1">{messageErreurAssistant(recherche.erreur)}</p>
        {brut && <pre className="mt-3 text-xs whitespace-pre-wrap font-sans text-secondary-700 bg-secondary-50 border border-secondary-200 rounded-lg p-3">{brut}</pre>}
      </div>
    );
  }
  if (recherche.reponse && typeof recherche.reponse === 'object') return <Structuree reponse={recherche.reponse} date={date} />;
  if (brut) {
    return (
      <div>
        <p className="text-xs text-secondary-600 mb-2">Réponse non structurée : affichée telle que reçue.</p>
        <pre className="text-sm whitespace-pre-wrap font-sans text-secondary-800 bg-secondary-50 border border-secondary-200 rounded-lg p-3">{brut}</pre>
      </div>
    );
  }
  return <p className="text-sm text-secondary-600">Aucune réponse enregistrée pour cette recherche.</p>;
}
