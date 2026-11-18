/**
 * PreparerPvDialog.jsx - Majord'home Artisan
 * ============================================================================
 * « Préparer le PV de réception » : avant d'envoyer le lien au client, le bureau répond,
 * point par point, à la déclaration de l'entreprise (faits techniques que le client ne peut
 * pas attester). Le client lira ces réponses avant de signer.
 *
 * - Les points viennent du gabarit du type d'équipement du chantier (`pvPoints.js`) ; le
 *   serveur dérive le gabarit de la même façon et fait foi : ici on AFFICHE et on envoie
 *   `{ [cle]: 'oui' | 'non' | 'sans_objet' }`.
 * - Aucune réponse n'est présélectionnée : une case jamais touchée n'est pas un « oui ».
 * - Le détail du PV (reprise d'une préparation) est INCONNU tant qu'il charge ou en erreur :
 *   dans cet état les boutons restent fermés, on n'affiche jamais une déclaration vide.
 *
 * Spec : docs/superpowers/specs/2026-11-18-pv-reception-points-levee-reserves-design.md
 * ============================================================================
 */

import { useEffect, useMemo, useState } from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { CheckCheck, Link2, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useChantierMutations, useChantierPv, useChantierPvMutations } from '@hooks/useChantiers';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { grouperTypesParCategorie } from '@/lib/equipmentReferential';
import { moduleActif } from '@/lib/modules';
import {
  declarationComplete, LIBELLE_REPONSE, LIBELLES_GABARIT, normaliserGabarit, pointsDuGabarit, REPONSES_ENTREPRISE,
} from '@/lib/pvPoints';
import { BOUTON_NEUTRE, BOUTON_PRINCIPAL } from './pvBoutons';

const RADIO = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 bg-white cursor-pointer '
  + 'hover:bg-gray-50 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-300';

/** Réponses déjà données, limitées aux points qui existent dans le gabarit. */
function reponsesDuGabarit(reponses, gabarit) {
  const cles = new Set(pointsDuGabarit(gabarit).entreprise.map((pt) => pt.cle));
  return Object.fromEntries(Object.entries(reponses || {}).filter(([cle, rep]) => cles.has(cle) && REPONSES_ENTREPRISE.includes(rep)));
}

export function PreparerPvDialog({ open, onOpenChange, chantier, canEdit, onUpdated }) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { settings } = useOrgSettings();
  const communicationOuverte = moduleActif(settings, 'communication');
  const { pv, isLoading: pvEnChargement, error: pvEnErreur } = useChantierPv(orgId, chantier.id, { enabled: open });
  const { equipmentTypes, index, isLoading: refEnChargement, error: refEnErreur } = useEquipmentReferential();
  const { updateEquipmentType, isUpdatingEquipmentType } = useChantierMutations();
  const { preparerPv, envoyerPv, lienPv, isPreparationPv, isEnvoiPv, isLienPv } = useChantierPvMutations();

  const [typeId, setTypeId] = useState(chantier.equipment_type_id || '');
  const [changerType, setChangerType] = useState(false);
  const [reponses, setReponses] = useState({});
  const [amorce, setAmorce] = useState(false);

  const donneesInconnues = Boolean(pvEnChargement || pvEnErreur || refEnChargement || refEnErreur);
  const deja = Boolean(pv?.signed_at || chantier.pv_signed_at);
  const type = equipmentTypes.find((t) => t.id === typeId) || null;
  const gabarit = normaliserGabarit(type?.reception_profile);
  const points = useMemo(() => pointsDuGabarit(gabarit), [gabarit]);
  const actives = useMemo(() => reponsesDuGabarit(reponses, gabarit), [reponses, gabarit]);
  const complete = declarationComplete(gabarit, actives);
  const occupe = isPreparationPv || isEnvoiPv || isLienPv;

  // Reprise d'une préparation existante : une fois par ouverture, quand tout est connu.
  useEffect(() => {
    if (!open) { setAmorce(false); setChangerType(false); return; }
    if (amorce || donneesInconnues) return;
    setTypeId(chantier.equipment_type_id || '');
    const precedent = Object.fromEntries((pv?.points_entreprise || []).map((pt) => [pt.cle, pt.reponse]));
    setReponses(reponsesDuGabarit(precedent, normaliserGabarit(
      equipmentTypes.find((t) => t.id === chantier.equipment_type_id)?.reception_profile,
    )));
    setAmorce(true);
  }, [open, amorce, donneesInconnues, pv, chantier.equipment_type_id, equipmentTypes]);

  const choisirType = async (id) => {
    if (!id || id === typeId) return;
    try {
      await updateEquipmentType(chantier.id, id);
      const nouveau = normaliserGabarit(equipmentTypes.find((t) => t.id === id)?.reception_profile);
      setTypeId(id);
      setReponses((prec) => reponsesDuGabarit(prec, nouveau));
      setChangerType(false);
      onUpdated?.();
    } catch (err) {
      toast.error(err?.message || 'Le type d\'équipement n\'a pas pu être enregistré');
    }
  };

  const agir = async (mode) => {
    let prepare = false;
    try {
      await preparerPv({ chantierId: chantier.id, reponses: actives });
      prepare = true;
      if (mode === 'envoyer') {
        const res = await envoyerPv(chantier.id);
        toast.success(`PV envoyé à ${res?.sent_to || 'l\'adresse du client'}`);
      } else {
        const res = await lienPv(chantier.id);
        await navigator.clipboard.writeText(res.url);
        toast.success('Lien copié : collez-le dans un SMS ou un message au client');
      }
      onUpdated?.();
      onOpenChange(false);
    } catch (err) {
      const suite = prepare ? ' Votre déclaration est enregistrée.' : '';
      toast.error(`${err?.message || (mode === 'envoyer' ? 'Le PV n\'a pas pu être envoyé.' : 'Le lien n\'a pas pu être copié.')}${suite}`);
      if (prepare) onUpdated?.();
    }
  };

  const fermes = !canEdit || donneesInconnues || deja || !complete || occupe;
  const groupes = grouperTypesParCategorie(index);
  const libelleType = type?.label || chantier.equipment_type_label || '';

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 max-h-[90vh] overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 shadow-xl max-sm:max-h-[90dvh]"
        >
          <AlertDialogPrimitive.Title className="text-lg font-semibold text-gray-900">Préparer le PV de réception</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-1 text-sm text-gray-500">
            Le client lit cette déclaration avant de signer. Vous pouvez la reprendre tant qu&apos;il n&apos;a pas signé.
          </AlertDialogPrimitive.Description>

          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-gray-700">Équipement :</span>
              {libelleType && !changerType ? (
                <>
                  <span className="text-gray-900">{libelleType}</span>
                  {canEdit && !donneesInconnues && (
                    <button type="button" onClick={() => setChangerType(true)} className="text-blue-700 underline text-sm">changer</button>
                  )}
                </>
              ) : (
                <>
                  <select
                    aria-label="Type d'équipement du chantier"
                    value=""
                    disabled={!canEdit || donneesInconnues || isUpdatingEquipmentType}
                    onChange={(e) => choisirType(e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                  >
                    <option value="">{libelleType ? 'Choisir un autre type…' : 'Choisir le type d\'équipement…'}</option>
                    {groupes.map((g) => (
                      <optgroup key={g.category?.id || 'sans'} label={g.label}>
                        {g.types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  {isUpdatingEquipmentType && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                  {!libelleType && <span className="text-xs text-gray-500">Facultatif : sans type, les points sont ceux d&apos;un PV générique.</span>}
                </>
              )}
            </div>
            {!donneesInconnues && type && (
              <p className="text-xs text-gray-500">Points du gabarit : {LIBELLES_GABARIT[gabarit]}.</p>
            )}

            {pvEnChargement || refEnChargement ? (
              <p className="flex items-center gap-2 text-sm text-gray-500" role="status">
                <Loader2 className="w-4 h-4 animate-spin" /> Chargement de la déclaration…
              </p>
            ) : donneesInconnues ? (
              <p className="text-sm text-red-700" role="alert">
                La déclaration n&apos;a pas pu être chargée : fermez cette fenêtre et rouvrez-la.
              </p>
            ) : deja ? (
              <p className="text-sm text-gray-700" role="status">Le client a déjà signé ce PV : la déclaration n&apos;est plus modifiable.</p>
            ) : (
              <section aria-labelledby="pv-declaration" className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 id="pv-declaration" className="text-sm font-semibold text-gray-900">L&apos;entreprise déclare</h3>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setReponses(Object.fromEntries(points.entreprise.map((pt) => [pt.cle, 'oui'])))}
                    className={BOUTON_NEUTRE}
                  >
                    <CheckCheck className="w-4 h-4" />
                    Tout est fait
                  </button>
                </div>
                <div className="space-y-2">
                  {points.entreprise.map((pt) => (
                    <fieldset key={pt.cle} className="border border-gray-200 rounded-lg px-3 py-2">
                      <legend className="sr-only">{pt.texte}</legend>
                      <p className="text-sm text-gray-800 mb-1.5" aria-hidden="true">{pt.texte}</p>
                      <div className="flex flex-wrap gap-2">
                        {REPONSES_ENTREPRISE.map((rep) => (
                          <label key={rep} className={RADIO}>
                            <input
                              type="radio"
                              name={`pv-${pt.cle}`}
                              value={rep}
                              checked={actives[pt.cle] === rep}
                              disabled={!canEdit}
                              onChange={() => setReponses((prec) => ({ ...prec, [pt.cle]: rep }))}
                              className="accent-blue-600"
                            />
                            {LIBELLE_REPONSE[rep]}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
                <p className="text-xs text-gray-500">Le client verra ces réponses avant de signer.</p>
              </section>
            )}
          </div>

          {!donneesInconnues && !deja && !complete && (
            <p className="mt-3 text-sm text-amber-800" role="status">Répondez à chaque point pour envoyer le PV.</p>
          )}
          {communicationOuverte && chantier.email && !donneesInconnues && !deja && (
            <p className="mt-1 text-xs text-gray-500">L&apos;e-mail part à {chantier.email}.</p>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <AlertDialogPrimitive.Cancel className={BOUTON_NEUTRE} disabled={occupe}>Annuler</AlertDialogPrimitive.Cancel>
            <button type="button" disabled={fermes} onClick={() => agir('lien')} className={BOUTON_NEUTRE}>
              {isLienPv ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Copier le lien
            </button>
            {communicationOuverte && (
              <button type="button" disabled={fermes} onClick={() => agir('envoyer')} className={BOUTON_PRINCIPAL}>
                {isEnvoiPv ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Envoyer au client
              </button>
            )}
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export default PreparerPvDialog;
