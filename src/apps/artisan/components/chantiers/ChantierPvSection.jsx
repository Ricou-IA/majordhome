/**
 * ChantierPvSection.jsx - Majord'home Artisan
 * ============================================================================
 * Section « PV de réception » de la fiche chantier.
 *
 * Trois façons d'obtenir le PV :
 *   - le client le signe EN LIGNE : le bureau lui envoie le lien par e-mail, ou le copie
 *     pour l'envoyer autrement (edge `chantier-pv`) ; la signature fait passer un chantier
 *     Planifié en Réceptionné ;
 *   - signature sur place, sur tablette (page /chantiers/:id/pv-reception) ;
 *   - à défaut, « Valider la réception sans PV ».
 *
 * Spec : docs/superpowers/specs/2026-11-17-chantier-apres-vente-pv-en-ligne-design.md
 * ============================================================================
 */

import { useState } from 'react';
import { FileText, CheckCircle2, AlertTriangle, ExternalLink, PenTool, Send, Link2, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useChantierPv } from '@hooks/useChantiers';
import { moduleActif } from '@/lib/modules';
import { formatDateTimeFR } from '@/lib/utils';
import { BOUTON_NEUTRE, BOUTON_PRINCIPAL } from './pvBoutons';
import { PreparerPvDialog } from './PreparerPvDialog';
import { ChantierPvReserves } from './ChantierPvReserves';
import { useOuvrirPv } from './useOuvrirPv';

export function ChantierPvSection({ chantier, canEdit, isUpdatingStatus, onSignerSurPlace, onValiderSansPv, onUpdated }) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { settings } = useOrgSettings();
  const communicationOuverte = moduleActif(settings, 'communication');

  const signeEnLigne = Boolean(chantier.pv_signed_at);
  const archive = Boolean(chantier.pv_reception_path);
  const signe = signeEnLigne || archive;
  const envoye = Boolean(chantier.pv_sent_at);

  // Détail de l'envoi et de la signature : chargé seulement s'il y a quelque chose à dire.
  const { pv, isLoading: pvEnChargement, error: pvEnErreur } = useChantierPv(orgId, chantier.id, { enabled: envoye || signeEnLigne });
  const { ouvrirPv, enCours: pvEnOuverture } = useOuvrirPv({ onUpdated });
  const [preparation, setPreparation] = useState(false);
  // Détail du PV inconnu (chargement, erreur) ≠ « pas de réponse » : rien n'est proposé sur une donnée inconnue.
  const detailPv = pvEnChargement || pvEnErreur ? undefined : pv;

  // Fichier archivé s'il existe, sinon PDF produit depuis l'enregistrement puis archivé (useOuvrirPv).
  const handleVoir = () => ouvrirPv(chantier);

  const avecReserves = Boolean(chantier.pv_avec_reserves);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
        <FileText className="w-4 h-4" />
        PV de Réception
      </h3>

      {signe ? (
        <>
        <div className={`p-3 border rounded-lg space-y-2 ${avecReserves ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
          <div className="flex items-center gap-3 flex-wrap">
            {avecReserves
              ? <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              : <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${avecReserves ? 'text-amber-900' : 'text-green-800'}`}>
                {avecReserves ? 'PV signé avec réserves' : 'PV signé'}
              </p>
              {signeEnLigne && (
                <p className="text-xs text-secondary-600">
                  Signé en ligne le {formatDateTimeFR(chantier.pv_signed_at)}
                  {pv?.signataire_nom ? ` par ${pv.signataire_nom}` : ''}
                </p>
              )}
            </div>
            <button type="button" onClick={handleVoir} disabled={pvEnOuverture} className={BOUTON_NEUTRE}>
              {pvEnOuverture ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
              Voir le PV
            </button>
            {canEdit && !signeEnLigne && (
              <button type="button" onClick={onSignerSurPlace} className={BOUTON_NEUTRE}>
                <PenTool className="w-3.5 h-3.5" />
                Refaire
              </button>
            )}
          </div>
          {avecReserves && (
            <div className="text-sm text-amber-900 space-y-1 pl-8">
              {pv?.reserves_nature && <p><span className="font-medium">Réserves : </span>{pv.reserves_nature}</p>}
              {pv?.reserves_travaux && <p><span className="font-medium">Travaux à exécuter : </span>{pv.reserves_travaux}</p>}
            </div>
          )}
        </div>
        <ChantierPvReserves
          chantier={chantier} pv={detailPv} canEdit={canEdit}
          communicationOuverte={communicationOuverte} onUpdated={onUpdated}
        />
        </>
      ) : (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
          <p className="text-sm text-amber-800">
            {chantier.chantier_status === 'planification'
              ? 'Le PV de réception signé fait passer le chantier en « Réceptionné ». Le client peut le signer en ligne, depuis son téléphone.'
              : 'Ce chantier n\'a pas de PV de réception signé.'}
          </p>

          {envoye && (
            <p className="text-xs text-secondary-700">
              Lien envoyé le {formatDateTimeFR(chantier.pv_sent_at)}
              {pv?.sent_to ? ` à ${pv.sent_to}` : ''}
              {pv?.sent_count > 1 ? ` (${pv.sent_count} envois)` : ''}
              {' · '}
              {pv?.opened_at ? `ouvert le ${formatDateTimeFR(pv.opened_at)}, pas encore signé` : 'pas encore ouvert'}
            </p>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {communicationOuverte && (
                <button type="button" onClick={() => setPreparation(true)} className={BOUTON_PRINCIPAL}>
                  <Send className="w-4 h-4" />
                  {envoye ? 'Renvoyer au client' : 'Envoyer au client'}
                </button>
              )}
              <button type="button" onClick={() => setPreparation(true)} className={BOUTON_NEUTRE}>
                <Link2 className="w-4 h-4" />
                Copier le lien
              </button>
              <button type="button" onClick={onSignerSurPlace} className={BOUTON_NEUTRE}>
                <PenTool className="w-4 h-4" />
                Signer sur place
              </button>
              {chantier.chantier_status === 'planification' && (
                <button type="button" onClick={onValiderSansPv} disabled={isUpdatingStatus} className={BOUTON_NEUTRE}>
                  <CheckCircle2 className="w-4 h-4" />
                  Valider la réception sans PV
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <PreparerPvDialog open={preparation} onOpenChange={setPreparation} chantier={chantier} canEdit={canEdit} onUpdated={onUpdated} />
    </div>
  );
}

export default ChantierPvSection;
