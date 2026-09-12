// src/apps/artisan/components/tournees/FigerJourneeDialog.jsx
// ============================================================================
// Aperçu et confirmation de « Figer la journée » : chaque RDV avec son heure
// actuelle → définitive (figés grisés, inchangés), le nombre de SMS d'heure de
// passage, puis le bilan après écriture. Aucun calcul ici : useConsolidationJournee.
// ============================================================================
import { Lock, MoveHorizontal, ArrowRight, AlertTriangle } from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { formatDateFR } from '@/lib/utils';
import { formatDuree } from './tourneesPanelUtils';

const RAISONS = {
  fenetre: 'un RDV ne tient pas dans sa fenêtre de tolérance',
  budget: 'la journée dépasse le budget de travail du technicien',
  amplitude: 'la journée déborde de l’amplitude horaire',
};

export function FigerJourneeDialog({ journee, consolidation }) {
  const { ouvert, fermer, apercu, figer, enCours, resultat } = consolidation;
  const aChanger = (apercu?.lignes || []).filter((l) => !l.fige);
  const changes = aChanger.filter((l) => l.change);

  return (
    <ConfirmDialog
      open={ouvert}
      onOpenChange={(o) => { if (!o && !enCours) fermer(); }}
      title={`Figer la journée du ${formatDateFR(journee.date)} — ${journee.technicienNom}`}
      description={resultat
        ? 'Bilan de la consolidation.'
        : 'Les heures deviennent définitives et sont communiquées aux clients adaptables. Les rendez-vous figés ne bougent pas.'}
      confirmLabel={resultat ? 'OK' : `Figer ${aChanger.length} rendez-vous`}
      cancelLabel={resultat ? 'Fermer' : 'Annuler'}
      variant="default"
      loading={enCours}
      onConfirm={resultat ? fermer : figer}
    >
      <div className="mt-4 space-y-3 text-sm">
        {!resultat && apercu && !apercu.faisable && (
          <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 space-y-1.5">
            <p className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Impossible d’ordonnancer : {RAISONS[apercu.raison] || apercu.raison}.</span>
            </p>
            {/* La journée telle qu'elle est posée, en chiffres : c'est ce qui
                explique le refus (pas la raison d'une permutation quelconque). */}
            {apercu.diagnostic && (
              <ul className="text-xs space-y-0.5 pl-6">
                <li>
                  Telle que posée : {formatDuree(apercu.diagnostic.travailMinutes)} de travail
                  {' + '}{formatDuree(apercu.diagnostic.trajetsMinutes)} de trajets
                  {apercu.diagnostic.pauseMinutes ? ` (+ ${apercu.diagnostic.pauseMinutes} min de pause)` : ''}
                  {' = '}<span className="font-medium">{formatDuree(apercu.diagnostic.chargeMinutes)}</span>
                  {' pour un budget de '}{formatDuree(apercu.diagnostic.budgetMinutes)}
                  {apercu.diagnostic.depasseBudget ? ' — dépassé' : ''}.
                </li>
                {apercu.diagnostic.conflits.map((c) => (
                  <li key={c.id}>
                    {c.trajetMinutes} min de trajet {c.depuisLabel} → {c.label}, {c.disponibleMinutes} min disponibles.
                  </li>
                ))}
                {apercu.estime && <li className="text-amber-700">Trajets estimés à vol d’oiseau (matrice indisponible).</li>}
              </ul>
            )}
            <p className="text-xs pl-6">Décalez ou déplacez un rendez-vous à la main, puis réessayez.</p>
          </div>
        )}
        {!resultat && apercu?.faisable && (
          <>
            {apercu.estime && (
              <p className="text-xs text-amber-700">Trajets estimés à vol d’oiseau (matrice indisponible) — les heures peuvent varier de quelques minutes.</p>
            )}
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {apercu.lignes.map((l) => (
                <li key={l.id} className={`flex items-center gap-2 px-3 py-1.5 ${l.fige ? 'text-gray-400' : 'text-gray-800'}`}>
                  {l.fige ? <Lock className="h-3.5 w-3.5 shrink-0" /> : <MoveHorizontal className="h-3.5 w-3.5 shrink-0 text-primary-600" />}
                  <span className="truncate flex-1">{l.label}{l.ville ? ` (${l.ville})` : ''}</span>
                  <span className="tabular-nums">{l.avant}</span>
                  {l.change && <ArrowRight className="h-3.5 w-3.5 shrink-0" />}
                  {l.change && <span className="tabular-nums font-medium">{l.apres}</span>}
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-500">
              {changes.length} heure(s) modifiée(s) · {aChanger.length} client(s) recevront un SMS d’heure de passage (mobile FR uniquement).
            </p>
          </>
        )}
        {resultat && (
          <ul className="space-y-1">
            {resultat.perime ? (
              <li className="text-amber-800">Rien n’a été écrit : la journée a changé depuis l’aperçu.</li>
            ) : (
              <li>{resultat.figes} rendez-vous figé(s){resultat.echecs.length > 0 ? ' — arrêt au premier refus, aucun SMS envoyé' : ''}.</li>
            )}
            {resultat.echecs.length === 0 && <li>{resultat.sms} SMS d’heure de passage envoyé(s).</li>}
            {resultat.smsGabaritAbsent && (
              <li className="text-amber-700">Heures figées, mais SMS non envoyés : gabarit « heure_de_passage » absent (Settings → SMS).</li>
            )}
            {resultat.echecs.map((e) => <li key={e.label} className="text-red-600">Non figé : {e.label} — {e.message}</li>)}
            {resultat.smsEchecs.map((e) => <li key={e.label} className="text-amber-700">SMS non envoyé : {e.label} — {e.message}</li>)}
            {(resultat.smsSansMobile || []).length > 0 && (
              <li className="text-amber-700">
                À prévenir par téléphone (pas de mobile) : {resultat.smsSansMobile.map((s) => `${s.label}${s.phone ? ` (${s.phone})` : ''}`).join(', ')}.
              </li>
            )}
          </ul>
        )}
      </div>
    </ConfirmDialog>
  );
}
