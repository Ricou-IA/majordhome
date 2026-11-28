/**
 * PropositionsAspirateur.jsx — propositions de l'aspirateur à valider, groupées par article. Une proposition qui
 * remplit un champ vide est cochée d'office, une qui remplace une valeur ne l'est pas. Présentation et sélection ;
 * l'application et l'abandon sont faits par l'appelant (AspirateurFournisseur).
 */
import { useEffect, useMemo, useState } from 'react';
import { SidePanel } from '@/components/ui/side-panel';
import { Button } from '@/components/ui/button';
import { grouperPropositions, libelleProposition } from '@/lib/aspirateur/ecran';

export default function PropositionsAspirateur({ ouvert, onFermer, propositions, champs, onAppliquer, onEcarter, enCours }) {
  const groupes = useMemo(() => grouperPropositions(propositions || []), [propositions]);
  const [coches, setCoches] = useState(() => new Set());
  // La sélection repart des coches proposées à chaque nouvelle liste (après une application, par exemple).
  useEffect(() => { setCoches(new Set((propositions || []).filter((p) => p.cochee).map((p) => p.id))); }, [propositions]);

  const basculer = (id) => setCoches((avant) => { const s = new Set(avant); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const toutes = (propositions || []).map((p) => p.id);
  const toutCoche = toutes.length > 0 && toutes.every((id) => coches.has(id));

  return (
    <SidePanel
      ouvert={ouvert}
      onFermer={onFermer}
      largeur="lg"
      titre="Propositions de l’aspirateur"
      description={`${toutes.length} proposition${toutes.length > 1 ? 's' : ''} à valider · ${coches.size} cochée${coches.size > 1 ? 's' : ''}`}
      pied={(
        <>
          <Button type="button" variant="ghost" onClick={() => onEcarter([...coches])} disabled={enCours || coches.size === 0}>Écarter la sélection</Button>
          <Button type="button" onClick={() => onAppliquer([...coches])} disabled={enCours || coches.size === 0}>Appliquer la sélection</Button>
        </>
      )}
    >
      {groupes.length === 0 ? (
        <p className="text-sm text-secondary-500">Aucune proposition à valider.</p>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-xs text-secondary-600">
            <input type="checkbox" checked={toutCoche} onChange={() => setCoches(toutCoche ? new Set() : new Set(toutes))} />
            Tout cocher
          </label>
          {groupes.map((g) => (
            <section key={g.reference} className="rounded-lg border border-secondary-200 p-3 space-y-2">
              <h4 className="text-sm font-medium text-secondary-900">{g.nom} <span className="text-xs font-normal text-secondary-500">· {g.reference}</span></h4>
              <ul className="space-y-1">
                {g.lignes.map((p) => (
                  <li key={p.id}>
                    <label className="flex items-start gap-2 text-xs text-secondary-700">
                      <input type="checkbox" className="mt-0.5" checked={coches.has(p.id)} onChange={() => basculer(p.id)} />
                      <span>
                        {libelleProposition(p, champs)}
                        {p.source_url && <a href={p.source_url} target="_blank" rel="noreferrer" className="ml-1 text-primary-600 hover:underline">source</a>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </SidePanel>
  );
}
