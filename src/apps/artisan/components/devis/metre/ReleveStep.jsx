// src/apps/artisan/components/devis/metre/ReleveStep.jsx
// Étape 2 du métré : coupe cotée + formulaire de relevé + contrôles + liste de pièces,
// recalculés en direct par le moteur pur (src/lib/fumisterie). Le résultat est calculé UNE fois
// par l'orchestrateur (calculerMetreSurEcran) : ce qui s'affiche est ce qui sera injecté.
import { sortieMinimale } from '@/lib/fumisterie/index.js';
import CoupeCotee from './CoupeCotee';
import ReleveForm from './ReleveForm';
import ListePieces, { Alertes } from './ListePieces';

export default function ReleveStep({ bundle, reglages, releve, setReleve, resultat }) {
  const minSortie = resultat.geometrie ? resultat.geometrie.minSortie : null;
  const focusChamp = (cle) => { const el = document.getElementById(`fum-${cle}`); if (el) { el.focus(); el.select?.(); } };
  // Relevé incomplet ailleurs → minimum incalculable (NaN) : on ne l'écrit pas dans le champ.
  const ajuster = () => { const h = sortieMinimale({ ...bundle, reglages, releve }); if (Number.isFinite(h)) setReleve({ ...releve, hSortie: h }); };
  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-[1.45fr_1fr] gap-5 items-start">
        <div className="border border-secondary-200 rounded-xl bg-white p-2 lg:sticky lg:top-2">
          <p className="px-2 py-1 text-xs uppercase tracking-wide text-secondary-500">Coupe cotée · cliquez une cote pour la modifier</p>
          {resultat.geometrie && <CoupeCotee geometrie={resultat.geometrie} releve={releve} onFocusChamp={focusChamp} />}
        </div>
        <div className="border border-secondary-200 rounded-xl bg-white p-4"><ReleveForm gabarit={bundle.gabarit} releve={releve} onChange={setReleve} onAjuster={ajuster} minSortie={minSortie} /></div>
      </div>
      <section className="border border-secondary-200 rounded-xl bg-white p-4"><h3 className="text-xs uppercase tracking-wide text-secondary-500 mb-2">Contrôles</h3><Alertes alertes={resultat.alertes} /></section>
      <section className="border border-secondary-200 rounded-xl bg-white p-4"><h3 className="text-xs uppercase tracking-wide text-secondary-500 mb-2">Liste de pièces chiffrée · {resultat.lignes.length} lignes · Ø{releve.diametre}</h3><ListePieces lignes={resultat.lignes} totaux={resultat.totaux} /></section>
    </div>
  );
}
