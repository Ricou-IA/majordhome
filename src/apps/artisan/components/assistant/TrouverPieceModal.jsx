/**
 * TrouverPieceModal.jsx — Fenêtre « Trouver une pièce » d'un appareil
 * ============================================================================
 * Rappel de l'appareil, saisie de la demande, historique des recherches de CET appareil (partagé entre la fiche
 * client et la fiche SAV), réponse. La recherche dure environ deux minutes : on la suit toutes les 5 s, et
 * fermer la fenêtre ne l'arrête pas (une recherche `en_cours` reprend son suivi à la réouverture).
 * Spec : docs/superpowers/specs/2026-11-11-assistant-pieces-sav-hermes-design.md § 3
 * ============================================================================
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { X, Loader2, Search, Plus } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { useRecherchesPieces, useLancerRecherche, useSuiviRecherche } from '@hooks/useAssistantPieces';
import { assistantPiecesKeys } from '@hooks/cacheKeys';
import { DEMANDE_MAX, controlerDemande, messageErreurAssistant } from '@/lib/assistantPieces';
import { libelleEquipement } from '@/lib/equipmentReferential';
import { formatDateTimeFR } from '@/lib/utils';
import { logger } from '@lib/logger';
import ReponsePieces from './ReponsePieces';

const ETATS = { en_cours: 'En cours', terminee: 'Terminée', echec: 'Échec' };

function Rappel({ equipment, type }) {
  const lignes = [
    ['Type', type], ['Marque', equipment.brand], ['Modèle', equipment.model], ['N° de série', equipment.serial_number],
    ['Photo de plaque', equipment.nameplate_photo_path ? 'oui' : 'non'],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm bg-secondary-50 border border-secondary-200 rounded-lg p-3">
      {lignes.map(([nom, valeur]) => (
        <div key={nom} className="min-w-0">
          <dt className="text-xs text-secondary-500">{nom}</dt>
          <dd className="text-secondary-900 truncate">{valeur || 'non renseigné'}</dd>
        </div>
      ))}
    </dl>
  );
}

function Historique({ recherches, idAffiche, onChoisir }) {
  if (recherches.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-secondary-900 mb-1">Recherches précédentes</h4>
      <ul className="border border-secondary-200 rounded-lg divide-y divide-secondary-100 max-h-48 overflow-y-auto">
        {recherches.map((r) => (
          <li key={r.id}>
            <button
              type="button" onClick={() => onChoisir(r.id)} aria-current={r.id === idAffiche ? 'true' : undefined}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary-50 ${r.id === idAffiche ? 'bg-primary-50 font-medium' : ''}`}
            >
              <span className="block text-secondary-900 truncate">{r.demande}</span>
              <span className="block text-xs text-secondary-500">
                {formatDateTimeFR(r.created_at)} · {r.created_by_name || 'auteur inconnu'} · {ETATS[r.statut] || r.statut}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * @param {{ equipment: object, interventionId?: string|null, onClose: () => void }} p
 */
export default function TrouverPieceModal({ equipment, interventionId = null, onClose }) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const queryClient = useQueryClient();
  const { index: referentiel } = useEquipmentReferential();
  const { recherches, isLoading, error: erreurHistorique } = useRecherchesPieces(equipment.id);
  const { lancer, isLaunching } = useLancerRecherche(equipment.id);

  const [demande, setDemande] = useState('');
  // undefined = rien choisi (on reprend une recherche en cours s'il y en a une) ; null = nouvelle recherche ; id = cette recherche.
  const [choix, setChoix] = useState(undefined);
  const enCoursTrouvee = recherches.find((r) => r.statut === 'en_cours');
  const idAffiche = choix !== undefined ? choix : (enCoursTrouvee?.id ?? null);
  const ligne = recherches.find((r) => r.id === idAffiche) || null;

  // Suivi tant que la ligne est en cours (ou pas encore dans l'historique juste après le lancement).
  const aSuivre = idAffiche && (!ligne || ligne.statut === 'en_cours') ? idAffiche : null;
  const termine = () => queryClient.invalidateQueries({ queryKey: assistantPiecesKeys.parEquipement(orgId, equipment.id) });
  const { suivi, error: erreurSuivi } = useSuiviRecherche(aSuivre, termine);

  useEffect(() => {
    if (erreurHistorique) logger.error('[TrouverPieceModal] historique des recherches illisible', erreurHistorique);
  }, [erreurHistorique]);

  const lancement = useRef(false);
  useEffect(() => {
    const surTouche = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [onClose]);

  const chercher = async (e) => {
    e.preventDefault();
    if (lancement.current || isLaunching) return;
    const refus = controlerDemande(demande, null);
    if (refus) { toast.error(messageErreurAssistant(refus)); return; }
    lancement.current = true;
    try {
      const res = await lancer({ interventionId, demande: demande.trim() });
      setDemande('');
      setChoix(res?.id ?? null);
    } catch (err) {
      toast.error(messageErreurAssistant(err));
    } finally {
      lancement.current = false;
    }
  };

  // La recherche affichée : la ligne de l'historique, complétée par le suivi dès qu'il est final.
  const suiviFinal = suivi && suivi.id === idAffiche && suivi.statut !== 'en_cours' ? suivi : null;
  const courante = idAffiche
    ? { statut: 'en_cours', ...ligne, ...(suiviFinal ? { ...suiviFinal, texte_brut: suiviFinal.texte ?? ligne?.texte_brut } : {}) }
    : null;
  const enAttente = courante?.statut === 'en_cours';

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Trouver une pièce">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col m-4">
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b">
          <h3 className="text-base font-semibold text-secondary-900">Trouver une pièce</h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-secondary-100 rounded" aria-label="Fermer"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <Rappel equipment={equipment} type={libelleEquipement(equipment, referentiel)} />

          {idAffiche === null && (
            <form onSubmit={chercher} className="space-y-2">
              <label htmlFor="assistant-pieces-demande" className="block text-sm font-medium text-secondary-900">Pièce ou panne recherchée</label>
              <textarea
                id="assistant-pieces-demande" value={demande} onChange={(e) => setDemande(e.target.value)}
                maxLength={DEMANDE_MAX} rows={3} autoFocus
                placeholder="Ex. : résistance d’allumage, ou le poêle s’éteint après 10 minutes"
                className="w-full border border-secondary-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-secondary-500">Décrivez la pièce ou la panne, pas le client. ({demande.length}/{DEMANDE_MAX})</p>
                <button
                  type="submit" disabled={isLaunching || !demande.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLaunching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Chercher
                </button>
              </div>
            </form>
          )}

          {courante && (
            <div>
              <div className="flex items-start justify-between gap-3 mb-2">
                <p className="text-sm text-secondary-700 whitespace-pre-wrap min-w-0">
                  <span className="font-medium text-secondary-900">Demande : </span>{courante.demande || '—'}
                </p>
                <button type="button" onClick={() => setChoix(null)} className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline flex-shrink-0">
                  <Plus className="w-3.5 h-3.5" />Nouvelle recherche
                </button>
              </div>
              {enAttente ? (
                <div className="flex items-start gap-2 text-sm text-secondary-800 bg-secondary-50 border border-secondary-200 rounded-lg p-3" role="status">
                  <Loader2 className="w-4 h-4 animate-spin mt-0.5 flex-shrink-0" aria-hidden="true" />
                  <div>
                    <p>Recherche en cours, environ deux minutes. Vous pouvez fermer cette fenêtre.</p>
                    {erreurSuivi && !suivi && <p className="mt-1 text-xs text-secondary-600">Suivi momentanément impossible, nouvel essai automatique…</p>}
                    {erreurSuivi && suivi && <p className="mt-1 text-xs text-secondary-600">Le suivi a rencontré un problème : {messageErreurAssistant(erreurSuivi)}</p>}
                  </div>
                </div>
              ) : <ReponsePieces recherche={courante} />}
            </div>
          )}

          {isLoading ? <p className="text-sm text-secondary-500">Chargement de l&apos;historique…</p>
            : erreurHistorique ? <p className="text-sm text-secondary-600">Historique indisponible pour le moment.</p>
              : <Historique recherches={recherches} idAffiche={idAffiche} onChoisir={setChoix} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
