/**
 * TableauCommerciaux.jsx — bloc 2 du Dashboard : un seul tableau, deux lectures.
 *  - Par commercial : la période choisie, une ligne par commercial, écart à la période précédente.
 *  - Par mois : les 6 derniers mois, pour toute l'entreprise ou un commercial.
 * Les colonnes d'activité sont des événements de la période ; seuls « Gagnés à 30 j »
 * et « Délai » suivent le cycle de vie des leads reçus.
 */

import { useState } from 'react';
import { cn } from '@lib/utils';
import { Panneau, Th, Td, Vide } from './Tableau';
import { entier, euros, ecartSigne, gagnes30, delai, libelleMois, libelleComparaison } from './format';

const TOUS = '__tous__';

function Bascule({ valeur, onChange, options }) {
  return (
    <div className="inline-flex rounded-md border border-secondary-200 bg-secondary-50 p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={valeur === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            valeur === o.value ? 'bg-white text-secondary-900 shadow-sm' : 'text-secondary-600 hover:text-secondary-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Valeur d'activité, suivie de son écart à la période précédente quand il est fourni. */
function Activite({ valeur, precedent, formater = entier }) {
  return (
    <>
      {formater(valeur)}
      {precedent !== undefined && (
        <span className="ml-1.5 inline-block min-w-[2rem] text-left text-xs font-normal text-secondary-400">
          {ecartSigne(valeur, precedent, formater)}
        </span>
      )}
    </>
  );
}

function Gagnes30({ mesure }) {
  const g = gagnes30(mesure);
  return (
    <>
      {g.valeur}
      <span className="ml-1.5 text-xs font-normal text-secondary-400">{g.detail}</span>
    </>
  );
}

/** Les colonnes chiffrées d'une ligne (commercial, mois ou total). */
function Mesures({ actuel, precedent, fort = false }) {
  const p = precedent || {};
  const classe = fort ? 'font-semibold text-secondary-900' : undefined;
  return (
    <>
      <Td className={classe}><Activite valeur={actuel.leads} precedent={p.leads} /></Td>
      <Td className={classe}><Activite valeur={actuel.rdv} precedent={p.rdv} /></Td>
      <Td className={classe}><Activite valeur={actuel.devis} precedent={p.devis} /></Td>
      <Td className={classe}>{euros(actuel.montantDevis)}</Td>
      <Td className={classe}><Activite valeur={actuel.ventes} precedent={p.ventes} /></Td>
      <Td className={classe}><Activite valeur={actuel.ca} precedent={p.ca} formater={euros} /></Td>
      <Td className={cn(classe, 'border-l border-secondary-100')}><Gagnes30 mesure={actuel} /></Td>
      <Td className={classe}>{delai(actuel)}</Td>
    </>
  );
}

function EnTete({ premiere }) {
  return (
    <thead className="border-b border-secondary-200 bg-secondary-50">
      <tr>
        <Th gauche>{premiere}</Th>
        <Th>Leads reçus</Th>
        <Th title="Visites techniques et RDV agence datés de la période, hors annulés">RDV</Th>
        <Th>Devis émis</Th>
        <Th>Montant devis HT</Th>
        <Th>Ventes</Th>
        <Th>CA signé HT</Th>
        <Th className="border-l border-secondary-100" title="Part des leads reçus signés dans les 30 jours suivant leur arrivée">Gagnés à 30 j</Th>
        <Th title="Médiane arrivée du lead → signature, ventes de la période">Délai</Th>
      </tr>
    </thead>
  );
}

export function TableauCommerciaux({ dashboard, estCommercial }) {
  const [lecture, setLecture] = useState(estCommercial ? 'mois' : 'commercial');
  const [qui, setQui] = useState(TOUS);

  const { commerciaux, entreprise, parMois, periode } = dashboard;
  const lignesMois = qui === TOUS ? parMois.tous : parMois.parCommercial[qui] || [];
  const versus = libelleComparaison(periode.precedente);

  return (
    <Panneau
      titre="Commerciaux"
      precision={
        lecture === 'commercial'
          ? `Activité de la période, écart vs ${versus}. Les deux dernières colonnes suivent les leads reçus.`
          : 'Les 6 derniers mois, mesurés de la même façon : comparables d’un mois sur l’autre.'
      }
      actions={
        <>
          {lecture === 'mois' && !estCommercial && (
            <select
              value={qui}
              onChange={(e) => setQui(e.target.value)}
              aria-label="Commercial"
              className="h-7 rounded-md border border-secondary-200 bg-white px-2 text-xs text-secondary-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value={TOUS}>Toute l’entreprise</option>
              {commerciaux.map((c) => (
                <option key={c.id || 'non-assigne'} value={c.id}>{c.nom}</option>
              ))}
            </select>
          )}
          <Bascule
            valeur={lecture}
            onChange={setLecture}
            options={[{ value: 'commercial', label: 'Par commercial' }, { value: 'mois', label: 'Par mois' }]}
          />
        </>
      }
    >
      <div className="overflow-x-auto">
        {lecture === 'commercial' ? (
          commerciaux.length === 0 ? (
            <Vide>Aucune activité sur la période.</Vide>
          ) : (
            <table className="w-full">
              <EnTete premiere="Commercial" />
              <tbody className="divide-y divide-secondary-100">
                {commerciaux.map((c) => (
                  <tr key={c.id || 'non-assigne'} className="hover:bg-secondary-50/60">
                    <Td gauche className={c.id ? 'font-medium text-secondary-900' : 'text-secondary-500'}>{c.nom}</Td>
                    <Mesures actuel={c.actuel} precedent={c.precedent} />
                  </tr>
                ))}
              </tbody>
              {commerciaux.length > 1 && (
                <tfoot className="border-t border-secondary-200 bg-secondary-50">
                  <tr>
                    <Td gauche className="font-semibold text-secondary-900">Total</Td>
                    <Mesures actuel={entreprise.actuel} precedent={entreprise.precedent} fort />
                  </tr>
                </tfoot>
              )}
            </table>
          )
        ) : (
          <table className="w-full">
            <EnTete premiere="Mois" />
            <tbody className="divide-y divide-secondary-100">
              {[...lignesMois].reverse().map((l) => (
                <tr key={l.mois} className="hover:bg-secondary-50/60">
                  <Td gauche className="font-medium capitalize text-secondary-900">{libelleMois(l.mois)}</Td>
                  <Mesures actuel={l} />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panneau>
  );
}
