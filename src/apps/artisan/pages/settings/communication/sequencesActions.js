// src/apps/artisan/pages/settings/communication/sequencesActions.js
// Allumer, éteindre, régler le délai d'une séquence d'e-mails (`src/lib/sequencesEmails.js`).
// Une séquence allumée = sa campagne (`is_automated`) reliée à son segment ; rien n'est supprimé
// quand on l'éteint. Toute erreur est levée : l'écran la dit, il n'annonce jamais un succès à tort.
import { mailCampaignsService } from '@services/mailCampaigns.service';
import { mailSegmentsService } from '@services/mailSegments.service';
import { nomDuSegment, filtresDuSegment, filtresAvecDelai } from '@/lib/sequencesEmails';

const ok = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/**
 * @param {object} p
 * @param {string} p.orgId
 * @param {object} p.sequence modèle (`SEQUENCES_EMAILS`)
 * @param {object[]} p.campagnes toutes les campagnes de l'entreprise, archivées comprises
 * @param {object[]} p.segments tous ses segments, archivés compris
 * @param {string} p.statutId identifiant du statut visé
 * @param {number | null} p.delai
 */
export async function allumerSequence({ orgId, sequence, campagnes, segments, statutId, delai }) {
  const depuis = new Date().toISOString();
  const nom = nomDuSegment(sequence);

  let campagne = campagnes.find((c) => c.key === sequence.gabarit.key) ?? null;
  if (!campagne) campagne = ok(await mailCampaignsService.create({ org_id: orgId, ...sequence.gabarit }));
  else if (campagne.is_archived) campagne = ok(await mailCampaignsService.unarchive(campagne.id, orgId));

  // Le segment déjà relié à la campagne (celui qu'une entreprise a réglé à la main) est gardé tel quel.
  let segment = segments.find((s) => s.id === campagne.auto_segment_id && !s.is_archived)
    ?? segments.find((s) => s.name === nom && !s.is_archived) ?? null;
  if (!segment) {
    segment = ok(await mailSegmentsService.create({
      org_id: orgId, name: nom, audience: 'leads',
      description: `Créé par Réglages → E-mails & SMS : ${sequence.description}`,
      filters: filtresDuSegment(sequence, { statutId, delai, depuis }),
    }));
  } else if (!sequence.repere && segment.name === nom) {
    // Accueil rallumé : jamais vers les prospects arrivés pendant qu'il était éteint.
    segment = ok(await mailSegmentsService.update(segment.id, { filters: filtresDuSegment(sequence, { statutId, depuis }) }));
  }

  const sansCadence = !campagne.auto_cadence_days && !campagne.auto_cadence_minutes;
  ok(await mailCampaignsService.update(campagne.id, {
    is_automated: true,
    auto_segment_id: segment.id,
    next_run_at: null,
    ...(sansCadence ? sequence.cadence : {}),
  }, orgId));
}

/** @param {{ id: string, org_id: string }} campagne */
export async function eteindreSequence(campagne) {
  ok(await mailCampaignsService.update(campagne.id, { is_automated: false }, campagne.org_id));
}

/**
 * @param {object} sequence
 * @param {{ id: string, filters: object }} segment
 * @param {number} delai
 */
export async function reglerDelaiSequence(sequence, segment, delai) {
  ok(await mailSegmentsService.update(segment.id, { filters: filtresAvecDelai(sequence, segment.filters, delai) }));
}
