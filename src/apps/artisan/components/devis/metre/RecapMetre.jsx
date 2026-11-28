// src/apps/artisan/components/devis/metre/RecapMetre.jsx
// Récapitulatif du métré, lu en entier AVANT d'écrire dans le devis (recette du 2026-11-28 : « Injecter » écrivait
// 27 lignes d'un coup, pièces à 0 € comprises). Rendu pur : les listes viennent de aConfirmerAvantAjout.
import { AlertTriangle } from 'lucide-react';
import { StatusPill } from '@/components/ui/status-pill';
import { formatEuro } from '@/lib/utils';

const taux = (t) => `${String(t).replace('.', ',')} %`;

function Liste({ titre, pill, items }) {
  if (!items.length) return null;
  return (
    <section className="border border-secondary-200 rounded-xl bg-white p-4">
      <div className="flex items-center gap-2 mb-2"><h3 className="text-label text-secondary-900">{titre}</h3>{pill}</div>
      <ul className="space-y-1 text-sm text-secondary-800">{items.map((t, i) => <li key={`${t}-${i}`}>{t}</li>)}</ul>
    </section>
  );
}

export default function RecapMetre({ configLibelle, releve, fabricant, resultat, tvaDevis, aConfirmer }) {
  const { sansPrix, aValider, alertes } = aConfirmer;
  return (
    <div className="space-y-4 max-w-3xl">
      <section className="border border-secondary-200 rounded-xl bg-white p-4">
        <h3 className="font-display text-section text-secondary-900">Ce qui sera ajouté au devis</h3>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-secondary-600">Solution</dt><dd className="text-secondary-900">{configLibelle || '—'}{releve?.diametre ? ` · Ø${releve.diametre}` : ''}</dd>
          <dt className="text-secondary-600">Fabricant</dt><dd className="text-secondary-900">{fabricant || '—'}</dd>
          <dt className="text-secondary-600">Pièces</dt><dd className="text-secondary-900 tabular-nums">{resultat.lignes.length}</dd>
          <dt className="text-secondary-600">Total HT</dt><dd className="text-secondary-900 font-semibold tabular-nums">{formatEuro(resultat.totaux.vente_ht)}{sansPrix.length ? ' (hors pièces sans prix)' : ''}</dd>
          {tvaDevis != null && <><dt className="text-secondary-600">TVA du devis</dt><dd className="text-secondary-900 tabular-nums">{taux(tvaDevis)}</dd></>}
        </dl>
      </section>
      <Liste titre="Pièces sans prix" pill={<StatusPill tone="attente">{`Ajoutées à 0 € : ${sansPrix.length}`}</StatusPill>} items={sansPrix} />
      <Liste titre="Quantités à valider" pill={<StatusPill tone="attente">{String(aValider.length)}</StatusPill>} items={aValider} />
      {alertes.length > 0 && (
        <section className="border border-secondary-200 rounded-xl bg-white p-4">
          <div className="flex items-center gap-2 mb-2"><h3 className="text-label text-secondary-900">Alertes à accepter</h3><StatusPill tone="attente">{String(alertes.length)}</StatusPill></div>
          <ul className="space-y-1.5 text-sm text-secondary-800">
            {alertes.map((a, i) => <li key={`${a.code}-${i}`} className="flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-st-attente" /><span>{a.message}</span></li>)}
          </ul>
        </section>
      )}
      {sansPrix.length > 0 && <p className="text-sm text-secondary-600">Saisissez le prix des pièces sans prix dans le devis : l’envoi dans Pennylane reste fermé tant qu’une ligne est à 0 €.</p>}
    </div>
  );
}
