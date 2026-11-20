/**
 * ChantierPvReserves.jsx - Majord'home Artisan
 * ============================================================================
 * Suite d'un PV signé EN LIGNE avec réserves : le bureau répond (ce que l'entreprise va faire,
 * date d'engagement), puis demande au client de constater que les réserves sont levées.
 *
 * - Répondre n'est PAS un préalable à la demande de levée (une reprise faite le lendemain se
 *   clôt sans réponse écrite) ; la réponse reste modifiable jusqu'à la signature de la levée.
 *   Mais une réponse saisie et NON enregistrée ferme la demande de levée
 *   (`reponseReservesNonEnregistree`) : sinon elle serait perdue, et figée vide à la levée.
 * - `pv` vaut `undefined` tant que le détail du PV n'est pas connu (chargement, erreur) :
 *   `suiteDesReserves` rend alors `'aucune'` et le composant ne rend rien.
 * - La réponse part toujours en entier (texte ET date) : le serveur remplace les deux.
 *
 * Spec : docs/superpowers/specs/2026-11-18-pv-reception-points-levee-reserves-design.md
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Link2, Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { useChantierPvMutations } from '@hooks/useChantiers';
import { reponseReservesNonEnregistree, suiteDesReserves } from '@/lib/chantierApresVente';
import { dateLongue, jourDeParis, messagePv, validerReponseReserves } from '@/lib/pvReception';
import { formatDateTimeFR } from '@/lib/utils';
import { BOUTON_NEUTRE, BOUTON_PRINCIPAL } from './pvBoutons';
import { LienACopier } from './LienACopier';
import { copierDansPressePapiers, MESSAGE_COPIE_ECHOUEE } from './pvPressePapiers';
import { useOuvrirPv } from './useOuvrirPv';

export function ChantierPvReserves({ chantier, pv, canEdit, communicationOuverte, onUpdated }) {
  const suite = suiteDesReserves(chantier, pv);
  const {
    repondreReservesPv, demanderLeveePv, isReponseReservesPv, isDemandeLeveePv,
  } = useChantierPvMutations();
  const { ouvrirLevee, enCours: leveeEnOuverture } = useOuvrirPv({ onUpdated });
  const [reponse, setReponse] = useState(pv?.reserves_reponse || '');
  const [echeance, setEcheance] = useState(pv?.reserves_echeance || '');
  const [erreur, setErreur] = useState('');
  const [lienManuel, setLienManuel] = useState('');

  // Resynchronise avec l'enregistrement seulement quand sa valeur change (pas à chaque relecture).
  useEffect(() => { setReponse(pv?.reserves_reponse || ''); }, [pv?.reserves_reponse]);
  useEffect(() => { setEcheance(pv?.reserves_echeance || ''); }, [pv?.reserves_echeance]);

  if (suite === 'aucune') return null;

  const jourSignature = jourDeParis(pv.signed_at);
  const leveeSignee = suite === 'levee_signee';
  const nonEnregistree = reponseReservesNonEnregistree({ reponse, echeance }, pv);

  const handleRepondre = async (e) => {
    e.preventDefault();
    const code = validerReponseReserves({ reponse, echeance }, jourSignature);
    if (code) { setErreur(messagePv(code)); return; }
    setErreur('');
    try {
      await repondreReservesPv({ chantierId: chantier.id, reponse: reponse.trim() || null, echeance: echeance || null });
      toast.success('Réponse enregistrée : le client la lira en rouvrant son lien');
      onUpdated?.();
    } catch (err) {
      toast.error(err?.message || 'La réponse n\'a pas pu être enregistrée');
    }
  };

  const handleLevee = async (mode) => {
    if (nonEnregistree) return;
    setLienManuel('');
    let res;
    try {
      res = await demanderLeveePv({ chantierId: chantier.id, mode });
    } catch (err) {
      toast.error(err?.message || (mode === 'email' ? 'La demande n\'a pas pu être envoyée' : 'Le lien n\'a pas pu être obtenu'));
      return;
    }
    if (mode === 'email') {
      toast.success(`Demande envoyée à ${res?.sent_to || 'l\'adresse du client'}`);
    } else if (await copierDansPressePapiers(res.url)) {
      toast.success('Demande notée et lien copié : collez-le dans un SMS ou un message au client');
    } else {
      // La demande est notée côté serveur : seule la copie a échoué.
      setLienManuel(res.url);
      toast.error(MESSAGE_COPIE_ECHOUEE);
    }
    onUpdated?.();
  };

  const handleVoirLevee = () => ouvrirLevee(chantier);

  const champ = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50';

  return (
    <div className="p-3 border border-gray-200 rounded-lg bg-white space-y-3">
      <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        {leveeSignee ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />}
        Suite des réserves
      </h4>

      {leveeSignee ? (
        <div className="space-y-2">
          <p className="text-sm text-green-800 font-medium">
            Réserves levées le {formatDateTimeFR(pv.levee_signed_at)}
            {pv.levee_signataire_nom ? ` par ${pv.levee_signataire_nom}` : ''}
          </p>
          {pv.reserves_reponse && <p className="text-sm text-gray-700"><span className="font-medium">Réponse de l&apos;entreprise : </span>{pv.reserves_reponse}</p>}
          {pv.reserves_echeance && <p className="text-sm text-gray-700"><span className="font-medium">Engagement : </span>levées avant le {dateLongue(pv.reserves_echeance)}</p>}
          <button type="button" onClick={handleVoirLevee} disabled={leveeEnOuverture} className={BOUTON_NEUTRE}>
            {leveeEnOuverture ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
            Voir le PV de levée
          </button>
        </div>
      ) : (
        <>
          <form onSubmit={handleRepondre} className="space-y-2" noValidate>
            <p className="text-sm font-medium text-gray-800">Répondre aux réserves</p>
            <div>
              <label htmlFor={`pv-rep-${chantier.id}`} className="block text-xs text-gray-600 mb-1">Ce que l&apos;entreprise va faire</label>
              <textarea
                id={`pv-rep-${chantier.id}`} rows={3} value={reponse} disabled={!canEdit}
                onChange={(e) => setReponse(e.target.value)} className={champ}
              />
            </div>
            <div>
              <label htmlFor={`pv-ech-${chantier.id}`} className="block text-xs text-gray-600 mb-1">Réserves levées avant le</label>
              <input
                id={`pv-ech-${chantier.id}`} type="date" value={echeance} disabled={!canEdit} min={jourSignature || undefined}
                onChange={(e) => setEcheance(e.target.value)} className={`${champ} sm:w-auto`}
              />
            </div>
            {erreur && <p className="text-sm text-red-700" role="alert">{erreur}</p>}
            {canEdit && (
              <button type="submit" disabled={isReponseReservesPv} className={BOUTON_NEUTRE}>
                {isReponseReservesPv && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Enregistrer la réponse
              </button>
            )}
          </form>

          {suite === 'levee_demandee' && (
            <p className="text-sm text-gray-700">
              Levée demandée le {formatDateTimeFR(pv.levee_demandee_at)}
              {pv.levee_sent_to ? ` à ${pv.levee_sent_to}` : ''}
              {pv.levee_sent_count > 1 ? ` (${pv.levee_sent_count} envois)` : ''}
              {' · '}pas encore signée.
            </p>
          )}

          {canEdit && (
            <div className="space-y-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {communicationOuverte && (
                  <button
                    type="button" onClick={() => handleLevee('email')} disabled={isDemandeLeveePv || nonEnregistree}
                    aria-describedby={nonEnregistree ? `pv-levee-raison-${chantier.id}` : undefined} className={BOUTON_PRINCIPAL}
                  >
                    {isDemandeLeveePv ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                    {suite === 'levee_demandee' ? 'Redemander la levée par e-mail' : 'Demander la levée par e-mail'}
                  </button>
                )}
                <button
                  type="button" onClick={() => handleLevee('lien')} disabled={isDemandeLeveePv || nonEnregistree}
                  aria-describedby={nonEnregistree ? `pv-levee-raison-${chantier.id}` : undefined} className={BOUTON_NEUTRE}
                >
                  <Link2 className="w-4 h-4" />
                  Demander la levée : copier le lien
                </button>
              </div>
              {nonEnregistree && (
                <p id={`pv-levee-raison-${chantier.id}`} className="text-sm text-amber-800" role="status">
                  Enregistrez votre réponse avant de demander la levée.
                </p>
              )}
              <LienACopier url={lienManuel} id={`pv-levee-lien-${chantier.id}`} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ChantierPvReserves;
