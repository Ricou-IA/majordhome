/**
 * PortefeuilleOuvert.jsx — bloc 3 du Dashboard : ce qui attend aujourd'hui, par commercial
 * (indépendant de la période choisie). Une ligne ouvre le Kanban sur ce commercial.
 */

import { ChevronRight } from 'lucide-react';
import { SEUIL_RELANCE_JOURS } from '@lib/pipelineDashboard';
import { Panneau, Th, Td, Vide } from './Tableau';
import { entier, euros } from './format';

function Chiffres({ ligne, fort = false }) {
  const classe = fort ? 'font-semibold text-secondary-900' : undefined;
  return (
    <>
      <Td className={classe}>{entier(ligne.aContacter)}</Td>
      <Td className={classe}>{entier(ligne.rdvAReplanifier)}</Td>
      <Td className={classe}>{entier(ligne.devisEnAttente)}</Td>
      <Td className={classe}>{euros(ligne.montantEnAttente)}</Td>
      <Td className={ligne.devisSansRelance > 0 ? 'font-semibold text-amber-700' : classe}>
        {entier(ligne.devisSansRelance)}
      </Td>
    </>
  );
}

/**
 * @param {Object} props
 * @param {{ lignes: Object[], total: Object }} props.portefeuille
 * @param {(commercialId: string) => void} [props.onOuvrirKanban]
 */
export function PortefeuilleOuvert({ portefeuille, onOuvrirKanban }) {
  const { lignes, total } = portefeuille;

  return (
    <Panneau
      titre="À traiter maintenant"
      precision="Le portefeuille ouvert aujourd’hui, hors projets en suivi MT-LT. Ne dépend pas de la période."
    >
      <div className="overflow-x-auto">
        {lignes.length === 0 ? (
          <Vide>Rien n’attend : aucun lead à contacter, aucun RDV à replanifier, aucun devis en attente.</Vide>
        ) : (
          <table className="w-full">
            <thead className="border-b border-secondary-200 bg-secondary-50">
              <tr>
                <Th gauche>Commercial</Th>
                <Th title="Cartes de la colonne Nouveau">À contacter</Th>
                <Th title="Cartes RDV planifié sans RDV actif au planning">RDV à replanifier</Th>
                <Th>Devis en attente</Th>
                <Th>Montant en attente HT</Th>
                <Th title={`Devis en attente sans relance ni contact depuis plus de ${SEUIL_RELANCE_JOURS} jours`}>
                  Sans relance &gt; {SEUIL_RELANCE_JOURS} j
                </Th>
                {onOuvrirKanban && <Th><span className="sr-only">Ouvrir le Kanban</span></Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-100">
              {lignes.map((l) => (
                <tr key={l.id || 'non-assigne'} className="hover:bg-secondary-50/60">
                  <Td gauche className={l.id ? 'font-medium text-secondary-900' : 'text-secondary-500'}>{l.nom}</Td>
                  <Chiffres ligne={l} />
                  {onOuvrirKanban && (
                    <Td>
                      <button
                        type="button"
                        onClick={() => onOuvrirKanban(l.id)}
                        className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        aria-label={`Ouvrir le Kanban de ${l.nom}`}
                      >
                        Kanban
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
            {lignes.length > 1 && (
              <tfoot className="border-t border-secondary-200 bg-secondary-50">
                <tr>
                  <Td gauche className="font-semibold text-secondary-900">Total</Td>
                  <Chiffres ligne={total} fort />
                  {onOuvrirKanban && <Td />}
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </Panneau>
  );
}
