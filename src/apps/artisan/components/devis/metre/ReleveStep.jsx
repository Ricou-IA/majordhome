// src/apps/artisan/components/devis/metre/ReleveStep.jsx
// Étape 2 du métré : coupe cotée + formulaire de relevé + contrôles + liste de pièces,
// recalculés en direct par le moteur pur (src/lib/fumisterie).
import { useMemo } from 'react';
import { calculerMetre, sortieMinimale } from '@/lib/fumisterie/index.js';
import CoupeCotee from './CoupeCotee';
import ReleveForm from './ReleveForm';
import ListePieces, { Alertes } from './ListePieces';

export default function ReleveStep({ bundle, articles, reglages, releve, setReleve }) {
  const resultat = useMemo(() => {
    try { return calculerMetre({ ...bundle, articles, reglages, releve }); }
    catch (e) { return { erreur: e.message, lignes: [], alertes: [{ niveau: 'warn', code: 'moteur', message: e.message, source: 'moteur' }], totaux: { vente_ht: 0, achat_ht: 0, marge_ht: 0, lignes_a_chiffrer: 0 }, geometrie: null }; }
  }, [bundle, articles, reglages, releve]);
  const minSortie = resultat.geometrie ? resultat.geometrie.minSortie : null;
  const focusChamp = (cle) => { const el = document.getElementById(`fum-${cle}`); if (el) { el.focus(); el.select?.(); } };
  const ajuster = () => setReleve({ ...releve, hSortie: sortieMinimale({ ...bundle, reglages, releve }) });
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
