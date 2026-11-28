// src/apps/artisan/components/devis/metre/ReleveStep.jsx
// Étape 2 du métré : coupe cotée + formulaire de relevé + contrôles + liste de pièces,
// recalculés en direct par le moteur pur (src/lib/fumisterie). Le résultat est calculé UNE fois
// par l'orchestrateur (comparerFabricants, colonne du fabricant choisi) : ce qui s'affiche est ce qui sera injecté.
import { useMemo } from 'react';
import { sortieMinimale } from '@/lib/fumisterie/index.js';
import { explicationSortie, textesSortie } from '@/lib/fumisterie/explicationSortie.js';
import CoupeCotee from './CoupeCotee';
import ReleveForm from './ReleveForm';
import ComplementsForm from './ComplementsForm';
import ListePieces, { Alertes } from './ListePieces';
import ComparaisonFabricants from './ComparaisonFabricants';
import { messageChamp, titreChampsAcorriger } from '@/lib/fumisterie/messagesReleve.js';

// `erreurs` : refus du relevé par clé (champsAcorriger), écrits sous chaque champ.
export default function ReleveStep({ bundle, reglages, releve, setReleve, resultat, erreurs, aCorriger = [], comparaison, fabricantChoisi, onChoisirFabricant }) {
  // Valeur que « Ajuster » écrit (relevé incomplet ailleurs ⇒ incalculable, rien n'est écrit) et son explication.
  const appliquee = useMemo(() => (resultat.geometrie ? sortieMinimale({ ...bundle, reglages, releve }) : null), [resultat.geometrie, bundle, reglages, releve]);
  const explication = explicationSortie(bundle.gabarit?.code, resultat.geometrie, appliquee, releve.hSortie);
  const sortie = explication ? textesSortie(explication) : null;
  const focusChamp = (cle) => { const el = document.getElementById(`fum-${cle}`); if (el) { el.focus(); el.select?.(); } };
  // Relevé incomplet ailleurs → minimum incalculable (NaN) : on ne l'écrit pas dans le champ.
  const ajuster = () => { if (Number.isFinite(appliquee)) setReleve({ ...releve, hSortie: appliquee }); };
  return (
    <div className="space-y-5">
      {aCorriger.length > 0 && (
        <div role="alert" className="p-4 rounded-xl border border-st-alerte/30 bg-st-alerte-bg text-secondary-800">
          <p className="font-semibold">{titreChampsAcorriger(aCorriger.length)}</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {aCorriger.map((e) => (
              <li key={e.cle}><a href={`#fum-${e.cle}`} onClick={(ev) => { ev.preventDefault(); focusChamp(e.cle); }} className="underline underline-offset-2 hover:text-secondary-900">{messageChamp(e)}</a></li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid lg:grid-cols-[1.45fr_1fr] gap-5 items-start">
        <div className="border border-secondary-200 rounded-xl bg-white p-2 lg:sticky lg:top-2">
          <p className="px-2 py-1 text-xs uppercase tracking-wide text-secondary-500">Coupe cotée · cliquez une cote pour la modifier</p>
          {resultat.geometrie
            ? <CoupeCotee gabaritCode={bundle.gabarit?.code} geometrie={resultat.geometrie} releve={releve} onFocusChamp={focusChamp} />
            : <p className="p-3 text-sm text-secondary-600">{resultat.erreur ? 'La coupe s’affiche quand le relevé est complet.' : `Pas de coupe dessinée pour le gabarit ${bundle.gabarit?.code}.`}</p>}
        </div>
        <div className="border border-secondary-200 rounded-xl bg-white p-4">
          <ReleveForm gabarit={bundle.gabarit} releve={releve} onChange={setReleve} onAjuster={ajuster} sortie={sortie} erreurs={erreurs} />
          <ComplementsForm gabaritCode={bundle.gabarit?.code} releve={releve} onChange={setReleve} />
        </div>
      </div>
      {resultat.alertes.some((a) => a.niveau !== 'verifier') && (
        <section className="border border-secondary-200 rounded-xl bg-white p-4"><h3 className="text-xs uppercase tracking-wide text-secondary-500 mb-2">Contrôles</h3><Alertes alertes={resultat.alertes.filter((a) => a.niveau !== 'verifier')} /></section>
      )}
      {resultat.alertes.some((a) => a.niveau === 'verifier') && (
        <section className="border border-secondary-200 rounded-xl bg-white p-4"><h3 className="text-xs uppercase tracking-wide text-secondary-500 mb-2">À vérifier sur place · imprimé sur la fiche chantier</h3><Alertes alertes={resultat.alertes.filter((a) => a.niveau === 'verifier')} /></section>
      )}
      <ComparaisonFabricants comparaison={comparaison} choisi={fabricantChoisi} onChoisir={onChoisirFabricant} />
      {!resultat.erreur && <section className="border border-secondary-200 rounded-xl bg-white p-4"><h3 className="text-xs uppercase tracking-wide text-secondary-500 mb-2">Liste de pièces chiffrée · {resultat.lignes.length} lignes · Ø{releve.diametre}</h3><ListePieces lignes={resultat.lignes} totaux={resultat.totaux} /></section>}
    </div>
  );
}
