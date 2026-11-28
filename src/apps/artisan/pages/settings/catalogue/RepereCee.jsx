// RepereCee.jsx — repère CEE (fiche BAR-TH-112) d'un poêle dans la fiche article.
// Lecture seule et JAMAIS bloquant : le devis s'enregistre et s'envoie quel que soit le verdict.
// Règle : src/lib/cee/barTh112.js ; ton : toneFor('cee', statut). Monté seulement pour la catégorie « poele ».
import { useMemo } from 'react';
import { StatusPill } from '@components/ui/status-pill';
import { toneFor } from '@/lib/tonsStatut';
import { verdictBarTh112 } from '@/lib/cee/barTh112';
import { canonicalFieldsForCategory } from '@/shared/specs';

const LIBELLES = {
  conforme: 'Conforme CEE',
  hors_seuil: 'Hors seuil CEE',
  incomplet: 'Incomplet pour le CEE',
  inconnu: 'CEE : combustible à préciser',
};

const nombreFr = (n) => String(n).replace('.', ',');

export default function RepereCee({ canonical }) {
  const verdict = useMemo(() => verdictBarTh112(canonical), [canonical]);
  const champs = useMemo(() => Object.fromEntries(canonicalFieldsForCategory('poele').map((f) => [f.key, f])), []);
  const libelle = (cle) => champs[cle]?.label || cle;

  return (
    <div className="rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 space-y-1">
      <StatusPill tone={toneFor('cee', verdict.statut)}>{LIBELLES[verdict.statut]}</StatusPill>
      {verdict.depassements.map((d) => (
        <p key={d.cle} className="text-xs text-secondary-700">
          {libelle(d.cle)} : {nombreFr(d.valeur)} {d.cle === 'etas_pct' ? '<' : '>'} {nombreFr(d.seuil)}
        </p>
      ))}
      {verdict.manquants.length > 0 && (
        <p className="text-xs text-secondary-700">À renseigner : {verdict.manquants.map(libelle).join(', ')}</p>
      )}
      {verdict.remarques.map((r) => (
        <p key={r} className="text-xs text-secondary-600">{r}</p>
      ))}
      {verdict.statut === 'inconnu' && (
        <p className="text-xs text-secondary-600">Choisissez le combustible (bois ou granulés) pour juger les seuils.</p>
      )}
    </div>
  );
}
