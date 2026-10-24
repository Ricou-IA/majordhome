// src/apps/artisan/pages/settings/communication/assurerTexteEmail.js
// Garantit qu'un e-mail automatique (majordhome_mail_campaigns, is_transactional) a un texte :
// créé avec le texte par défaut, ou restauré s'il était archivé. Partagé par EmailAutoLigne
// (« Modifier le texte ») et AccueilLeadMetaSection (interrupteur).
import { mailCampaignsService } from '@services/mailCampaigns.service';

/**
 * Garantit que le texte de l'e-mail existe (créé avec le défaut, ou restauré). Throw sinon.
 * @param {string} orgId
 * @param {{ key: string }} gabarit — texte par défaut (key, label, subject, html_body, is_transactional)
 */
export async function assurerTexteEmail(orgId, gabarit) {
  const { data: actif, error } = await mailCampaignsService.getByKey(orgId, gabarit.key);
  if (error) throw error;
  if (actif) return;
  const { data: tous, error: lErr } = await mailCampaignsService.list(orgId, { includeArchived: true });
  if (lErr) throw lErr;
  const archive = (tous || []).find((c) => c.key === gabarit.key);
  if (archive) {
    const { error: uErr } = await mailCampaignsService.unarchive(archive.id);
    if (uErr) throw uErr;
    return;
  }
  const { error: cErr } = await mailCampaignsService.create({ org_id: orgId, ...gabarit });
  if (cErr) throw cErr;
}
