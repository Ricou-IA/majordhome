// src/apps/artisan/components/entretiens/CreneauxProposesPanel.jsx
// ============================================================================
// Les créneaux les moins coûteux pour un contrat d'entretien, explicables
// (technicien, heure, voisins de tournée, minutes ajoutées). Aucune logique de
// calcul ici : tout vient de l'edge slots-propose (même moteur que l'onglet
// Tournées). Le clic remonte un `slot` dans la forme consommée par
// savService.scheduleEntretien — la pose reste le chemin existant.
// ============================================================================
import { Loader2, Route, CalendarPlus, AlertTriangle } from 'lucide-react';
import { useCreneauxProposes } from '@hooks/useTournees';
import { formatDateShortFR } from '@/lib/utils';
import { Button } from '@components/ui/button';

const MOTIFS = {
  competence: 'technicien(s) sans la compétence',
  horizon: 'journée(s) vide(s) hors horizon ferme',
  contrainte: 'journée(s) exclue(s) par les contraintes',
  creneau: 'pas de trou assez grand',
  budget: 'journée(s) pleine(s)',
  pause: 'pause déjeuner impossible',
  position: 'client non localisé',
  trajet: 'trajet trop long entre deux clients',
};
const ERREURS = {
  siege_non_configure: 'Siège non configuré (Settings → Organisation → Territoire)',
  client_non_localise: 'Client non localisé : renseignez son adresse (suggestions BAN) puis réessayez',
  aucun_technicien: 'Aucun technicien inclus dans les tournées (Settings → Équipe)',
  contrat_introuvable: 'Contrat introuvable',
};

const hhmmVersMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};

const minutesVersHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const dureeCourte = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}` : `${min} min`);

/**
 * Lecture du temps restant après la pose (jusqu'au RDV suivant ou à la fin de
 * journée) : en dessous de la plus petite visite possible + un trajet, c'est du
 * temps perdu — c'est ce que l'opérateur doit voir, pas le détour net.
 */
const RESTE_UTILE_MIN = 75;
function lectureReste(reste, apres) {
  const cible = apres ? `avant ${apres.label}` : 'en fin de journée';
  if (reste <= 10) return { texte: `enchaîné ${cible}`, ton: 'text-secondary-600' };
  if (reste < RESTE_UTILE_MIN) return { texte: `${dureeCourte(reste)} perdues ${cible}`, ton: 'text-amber-700' };
  return { texte: `${dureeCourte(reste)} libres ${cible} — une autre visite y tient`, ton: 'text-green-700' };
}

/**
 * @param {object} props
 * @param {string} props.orgId        org CORE
 * @param {string} props.contractId
 * @param {string} props.clientName
 * @param {(slot: { date, startTime, endTime, duration, technicianIds, subject, nouvelleJournee?: boolean }) => void} props.onChoisir
 * @param {() => void} props.onFermer
 * @param {boolean} [props.busy]
 */
export function CreneauxProposesPanel({ orgId, contractId, clientName, onChoisir, onFermer, busy = false }) {
  const { data, isLoading, error } = useCreneauxProposes({ orgId, contractId });

  if (isLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-sm text-secondary-500 py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Calcul des créneaux (trajets réels)…
      </div>
    );
  }
  if (error) {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-sm text-red-600">{ERREURS[error.message] || `Erreur : ${error.message}`}</p>
        <Button variant="ghost" size="sm" onClick={onFermer}>Fermer</Button>
      </div>
    );
  }
  if (!data) return null;

  const { creneaux = [], nouvellesJournees = [], raisonsRejet = {}, estime, contrat } = data;
  const motifs = Object.entries(raisonsRejet)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${MOTIFS[k] || k}`);
  const sujet = `Entretien — ${clientName}`;

  return (
    <div className="mt-3 space-y-2">
      {estime && (
        <p className="text-xs text-amber-700 flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Trajets estimés à vol d&apos;oiseau (Mapbox indisponible)
        </p>
      )}
      {contrat?.sansEquipement && (
        <p className="text-xs text-amber-700">
          Aucun équipement rattaché à ce contrat : durée par défaut ({contrat.dureeMinutes} min).
        </p>
      )}
      {contrat?.typesNonRenseignes > 0 && (
        <p className="text-xs text-secondary-500">
          {contrat.typesNonRenseignes} équipement(s) sans type : durée par défaut appliquée ({contrat.dureeMinutes} min au total).
        </p>
      )}

      {creneaux.length === 0 && (
        <p className="text-sm text-secondary-600">
          Aucune insertion raisonnable dans une tournée existante{motifs.length ? ` — ${motifs.join(', ')}` : ''}.
          {nouvellesJournees.length > 0 && ' Ouvrez une nouvelle journée, puis remplissez-la avec les clients du secteur (onglet Tournées).'}
        </p>
      )}

      {creneaux.map((k) => (
        <button
          key={`${k.date}-${k.technicianId}-${k.debut}`}
          type="button"
          disabled={busy}
          className="w-full text-left rounded-md border border-secondary-200 hover:border-primary-400 hover:bg-primary-50 px-3 py-2 disabled:opacity-50"
          onClick={() => onChoisir({
            date: k.date,
            startTime: k.debut,
            endTime: k.fin,
            duration: hhmmVersMinutes(k.fin) - hhmmVersMinutes(k.debut),
            technicianIds: [k.technicianId],
            technicianNom: k.technicianNom,
            subject: sujet,
            // Voisin adaptable à glisser pour que ce créneau tienne (0 ou 1) — écrit
            // avec le RDV par scheduleEntretien, annoncé dans SouplesseDialog.
            decalages: (k.decalages || []).map((d) => ({ ...d, dureeMinutes: d.dureeMinutes ?? null })),
          })}
        >
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: k.couleur || '#94A3B8' }} />
            <span className="font-medium text-gray-900">{formatDateShortFR(k.date)} · {k.debut}</span>
            <span className="text-secondary-500 truncate">{k.technicianNom}</span>
            {/* Les trois chiffres de l'opérateur : trajet pour y aller, travail,
                reste utile (décision Eric 2026-09-12). Le coût total en info-bulle. */}
            <span
              className="ml-auto text-xs text-secondary-700 inline-flex items-center gap-1 shrink-0"
              title={`+${k.coutMinutes} min ajoutées à la journée (détour net ${k.detourMinutes} min)`}
            >
              <Route className="h-3.5 w-3.5" />{k.trajetAllerMinutes} min · {k.travailMinutes} min de travail
            </span>
          </div>
          <div className="text-xs text-secondary-500 mt-0.5 truncate">
            {k.avant ? `après ${k.avant.label}${k.avant.ville ? ` (${k.avant.ville})` : ''}` : 'depuis le dépôt'}
            {' → '}
            {k.apres ? `${k.trajetRetourMinutes} min → ${k.apres.label}${k.apres.ville ? ` (${k.apres.ville})` : ''}` : `${k.trajetRetourMinutes} min → retour dépôt`}
          </div>
          {(() => { const l = lectureReste(k.resteUtileMinutes, k.apres); return <div className={`text-xs mt-0.5 ${l.ton}`}>{l.texte}</div>; })()}
          {(k.decalages || []).map((d) => (
            <div key={d.id} className="text-xs mt-0.5 text-amber-700">
              rentre si {d.label} passe de {minutesVersHHMM(d.debutMinutesAvant)} à {minutesVersHHMM(d.debutMinutesApres)}
              {d.tolerance?.flex ? ` (±${d.tolerance.flex} min)` : ''}
            </div>
          ))}
        </button>
      ))}

      {nouvellesJournees.length > 0 && (
        <div className="text-sm text-secondary-700 rounded-md border border-dashed border-secondary-300 px-3 py-2">
          <p className="font-medium flex items-center gap-1">
            <CalendarPlus className="h-4 w-4" />
            Ouvrir une nouvelle journée
          </p>
          {nouvellesJournees.map((j) => (
            <button
              key={`${j.date}-${j.technicianId}`}
              type="button"
              disabled={busy}
              className="block text-primary-700 hover:underline text-xs mt-1 disabled:opacity-50"
              onClick={() => onChoisir({
                date: j.date,
                startTime: '08:00',
                endTime: null,
                duration: contrat?.dureeMinutes || 60,
                technicianIds: [j.technicianId],
                subject: sujet,
                nouvelleJournee: true,
              })}
            >
              {formatDateShortFR(j.date)} — {j.technicianNom || 'technicien'} (journée vide)
            </button>
          ))}
        </div>
      )}

      <Button variant="ghost" size="sm" onClick={onFermer} disabled={busy}>Fermer</Button>
    </div>
  );
}
