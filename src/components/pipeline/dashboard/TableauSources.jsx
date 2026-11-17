/**
 * TableauSources.jsx — la période choisie, par source du lead. Même lecture que le
 * tableau des commerciaux (les commerciaux ne reçoivent pas les mêmes leads).
 */

import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { downloadBlob } from '@lib/utils';
import { Panneau, Th, Td, Vide } from './Tableau';
import { entier, euros, gagnes30 } from './format';

function exporterCsv(sources) {
  const entete = ['Source', 'Leads reçus', 'RDV', 'Devis émis', 'Montant devis HT', 'Ventes', 'CA signé HT', 'Gagnés à 30 jours'];
  const lignes = sources.map((s) => [
    s.nom, s.actuel.leads, s.actuel.rdv, s.actuel.devis, s.actuel.montantDevis.toFixed(2),
    s.actuel.ventes, s.actuel.ca.toFixed(2), s.actuel.gagnes30,
  ]);
  const csv = [entete, ...lignes].map((l) => l.join(';')).join('\n');
  // BOM : sans lui, Excel lit les accents en Latin-1.
  downloadBlob(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' }), `sources-${new Date().toISOString().slice(0, 10)}.csv`);
  toast.success('Export CSV téléchargé');
}

export function TableauSources({ sources }) {
  return (
    <Panneau
      titre="Sources"
      precision="D’où viennent les leads de la période, et ce qu’ils deviennent."
      actions={
        sources.length > 0 && (
          <button
            type="button"
            onClick={() => exporterCsv(sources)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-secondary-200 bg-white px-2 text-xs font-medium text-secondary-700 hover:bg-secondary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <Download className="h-3.5 w-3.5" />
            Exporter
          </button>
        )
      }
    >
      <div className="overflow-x-auto">
        {sources.length === 0 ? (
          <Vide>Aucune activité sur la période.</Vide>
        ) : (
          <table className="w-full">
            <thead className="border-b border-secondary-200 bg-secondary-50">
              <tr>
                <Th gauche>Source</Th>
                <Th>Leads reçus</Th>
                <Th>RDV</Th>
                <Th>Devis émis</Th>
                <Th>Ventes</Th>
                <Th>CA signé HT</Th>
                <Th className="border-l border-secondary-100" title="Part des leads reçus signés dans les 30 jours suivant leur arrivée">Gagnés à 30 j</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-100">
              {sources.map((s) => {
                const g = gagnes30(s.actuel);
                return (
                  <tr key={s.id || 'sans-source'} className="hover:bg-secondary-50/60">
                    <Td gauche className={s.id ? 'font-medium text-secondary-900' : 'text-secondary-500'}>{s.nom}</Td>
                    <Td>{entier(s.actuel.leads)}</Td>
                    <Td>{entier(s.actuel.rdv)}</Td>
                    <Td>{entier(s.actuel.devis)}</Td>
                    <Td>{entier(s.actuel.ventes)}</Td>
                    <Td>{euros(s.actuel.ca)}</Td>
                    <Td className="border-l border-secondary-100">
                      {g.valeur}
                      <span className="ml-1.5 text-xs text-secondary-400">{g.detail}</span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Panneau>
  );
}
