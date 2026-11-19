/**
 * RapportSavDialog.jsx — « Rapport d'intervention » d'une demande SAV réalisée.
 *
 * Une page à l'en-tête de l'entreprise, sans signature du client (Eric 2026-11-19) : on relit ce
 * qui part chez le client, on édite (PDF archivé sur la carte), on ouvre, on envoie par e-mail.
 * Règles : src/lib/rapportSavModel.js et src/lib/rapportSav.js · chaîne : rapportSavExport.js.
 * Spec : docs/superpowers/specs/2026-11-19-rapport-intervention-sav-design.md
 */

import { useMemo, useState } from 'react';
import { X, FileText, Loader2, Send, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useSavPieces } from '@hooks/useSavPieces';
import { useRapportSav } from '@hooks/useRapportSav';
import { rapportSavService } from '@services/rapportSav.service';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { libelleEquipement } from '@/lib/equipmentReferential';
import { dateLocale } from '@/lib/savCloture';
import { formatDateTimeFR } from '@/lib/utils';
import { invoiceEmailAvailability, INVOICE_EMAIL_REASONS } from '@/lib/invoiceEmailModel';
import { rapportDeCarte, messageErreurRapportSav } from '@/lib/rapportSav';
import { contenuInitial, validerContenu, memeContenu, traceEnvoi } from '@/lib/rapportSavModel';
import { editerRapportSav } from './rapportSavExport';

const champ = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-50';
const etiquette = 'block text-sm font-medium text-gray-700 mb-1.5';

const appareilDepuis = (eq, referentiel) => ({
  id: eq.id, libelle: libelleEquipement(eq, referentiel), marque: eq.brand || '', modele: eq.model || '', numeroSerie: eq.serial_number || '',
});
const nomAppareil = (a) => [a.libelle, a.marque, a.modele].filter(Boolean).join(' · ');

/**
 * @param {object} p
 * @param {object} p.item  carte SAV (ligne de `majordhome_entretien_sav`), suivie en direct par la fiche
 * @param {object[]} p.equipements  équipements du client
 * @param {object} p.referentiel  index du référentiel d'équipements (libellés)
 * @param {object[]} p.membres  équipe (noms des intervenants)
 * @param {() => void} p.onClose
 */
export function RapportSavDialog({ item, equipements = [], referentiel, membres = [], onClose }) {
  const { user } = useAuth();
  const { settings } = useOrgSettings();
  const { orgId, passages, passagesInconnus, erreurPassages, rafraichirCartes, envoyer, envoiEnCours } = useRapportSav(item.id);
  const { selections, isLoading: piecesEnChargement, error: erreurPieces } = useSavPieces(item.id);

  const aujourdhui = dateLocale(new Date());
  const [traceLocale, setTraceLocale] = useState(null); // trace écrite pendant que la fenêtre est ouverte
  const [saisie, setSaisie] = useState(null); // `null` = contenu proposé, pas encore touché
  const [edition, setEdition] = useState(false);
  const trace = traceLocale ?? rapportDeCarte(item);

  // Listes inconnues (chargement ou échec) : on n'édite pas un rapport amputé sans le dire.
  const inconnu = passagesInconnus || piecesEnChargement || Boolean(erreurPieces);
  const erreurLecture = Boolean(erreurPassages || erreurPieces);

  const appareils = useMemo(() => equipements.map((eq) => appareilDepuis(eq, referentiel)), [equipements, referentiel]);
  const propose = useMemo(() => {
    if (inconnu) return null;
    const parDefaut = appareils.find((a) => a.id === item.equipment_id) || (appareils.length === 1 ? appareils[0] : null);
    return contenuInitial({ carte: item, rdvs: passages, membres, selections, appareil: parDefaut, aujourdhui, trace });
  }, [inconnu, appareils, item, passages, membres, selections, aujourdhui, trace]);
  const contenu = saisie ?? propose;
  const set = (cle) => (valeur) => setSaisie({ ...contenu, [cle]: valeur });

  const erreurs = contenu ? validerContenu(contenu, { aujourdhui }) : [];
  const aJour = Boolean(trace && contenu && memeContenu(contenu, trace.contenu));
  const nom = item.client_name || `${item.client_last_name || ''} ${item.client_first_name || ''}`.trim() || 'Sans nom';
  const email = invoiceEmailAvailability({ settings, mode: 'resend', clientEmail: item.client_email });

  const handleEditer = async () => {
    if (!contenu || erreurs.length > 0) { toast.error(erreurs[0] || 'Contenu du rapport indisponible'); return; }
    setEdition(true);
    try {
      const { trace: ecrite, avertissements } = await editerRapportSav({
        orgId,
        carte: item,
        contenu,
        client: { name: nom, address: item.client_address, postal_code: item.client_postal_code, city: item.client_city },
        company: buildCompanyInfo(settings),
        userId: user?.id || null,
      });
      setTraceLocale(ecrite);
      setSaisie(null);
      rafraichirCartes();
      toast.success('Rapport édité et archivé sur la carte');
      avertissements.forEach((a) => toast.warning(a));
    } catch (err) {
      toast.error(err?.message || 'Le rapport n’a pas pu être édité', { duration: 10000 });
    } finally {
      setEdition(false);
    }
  };

  const handleOuvrir = async () => {
    const { data: url, error } = await rapportSavService.getUrl(trace.path);
    if (error || !url) { toast.error('Rapport introuvable : éditez-le à nouveau'); return; }
    window.open(url, '_blank', 'noopener');
  };

  const handleEnvoyer = async () => {
    try {
      const { to, noteManquante } = await envoyer();
      setTraceLocale(traceEnvoi(trace, { to, maintenant: new Date().toISOString() }));
      toast.success(`Rapport envoyé à ${to}`);
      if (noteManquante) toast.warning('E-mail parti, mais la mention d’envoi n’a pas pu être notée sur la carte.');
    } catch (err) {
      const message = messageErreurRapportSav(err?.code);
      if (err?.code === 'envoi_pas_en_service') toast.info(message); else toast.error(message, { duration: 10000 });
    }
  };

  const motifEnvoi = !trace ? 'Éditez d’abord le rapport.'
    : !aJour ? 'Mettez à jour le rapport avant de l’envoyer.'
      : !email.enabled ? INVOICE_EMAIL_REASONS[email.reason] : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="rapport-sav-titre" className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[calc(100%-2rem)] max-w-xl bg-white rounded-xl shadow-2xl max-h-[calc(100vh-2rem)] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
              <FileText className="h-4 w-4 text-blue-700" />
            </div>
            <div className="min-w-0">
              <h3 id="rapport-sav-titre" className="text-base font-semibold text-gray-900">Rapport d&apos;intervention</h3>
              <p className="text-xs text-gray-500 truncate">{nom}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {trace && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p>Rapport édité le {formatDateTimeFR(trace.edite_le)}</p>
                <p className="text-xs text-gray-500">
                  {trace.envoye_le ? `Envoyé le ${formatDateTimeFR(trace.envoye_le)} à ${trace.envoye_a}` : 'Pas encore envoyé au client'}
                </p>
              </div>
              <button type="button" onClick={handleOuvrir} className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:underline shrink-0">
                <ExternalLink className="h-3.5 w-3.5" />
                Ouvrir
              </button>
            </div>
          )}

          {!contenu ? (
            erreurLecture ? (
              <p className="text-sm text-amber-800">
                Les rendez-vous ou les pièces de la carte n&apos;ont pas pu être lus : fermez et rouvrez la fenêtre.
              </p>
            ) : (
              <p className="text-sm text-gray-500 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lecture des rendez-vous et des pièces de la carte…
              </p>
            )
          ) : (
            <>
              <p className="text-xs text-gray-500">
                Ce texte part chez le client. Les notes internes de la carte n&apos;y figurent pas.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="rs-date" className={etiquette}>Date d&apos;intervention</label>
                  <input id="rs-date" type="date" max={aujourdhui} value={contenu.date} onChange={(e) => set('date')(e.target.value)} className={champ} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="rs-qui" className={etiquette}>Intervenant(s)</label>
                  <input id="rs-qui" type="text" value={contenu.intervenants} onChange={(e) => set('intervenants')(e.target.value)} placeholder="Prénom Nom" className={champ} />
                </div>
              </div>

              <div>
                <label htmlFor="rs-appareil" className={etiquette}>Appareil</label>
                <select
                  id="rs-appareil"
                  value={contenu.appareil?.id || ''}
                  onChange={(e) => set('appareil')(appareils.find((a) => a.id === e.target.value) || null)}
                  className={`${champ} bg-white`}
                >
                  <option value="">Aucun appareil précisé</option>
                  {/* Appareil du rapport déjà édité, s'il n'est plus sur la fiche du client */}
                  {contenu.appareil && !appareils.some((a) => a.id === contenu.appareil.id) && (
                    <option value={contenu.appareil.id || ''}>{nomAppareil(contenu.appareil)}</option>
                  )}
                  {appareils.map((a) => <option key={a.id} value={a.id}>{nomAppareil(a)}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="rs-probleme" className={etiquette}>Problème signalé</label>
                <textarea id="rs-probleme" rows={2} value={contenu.probleme} onChange={(e) => set('probleme')(e.target.value)} className={`${champ} resize-none`} />
              </div>

              <div>
                <label htmlFor="rs-travaux" className={etiquette}>Travaux réalisés <span className="text-red-500">*</span></label>
                <textarea
                  id="rs-travaux" rows={4} value={contenu.travaux} onChange={(e) => set('travaux')(e.target.value)}
                  placeholder="Ex : remplacement de la bougie d'allumage, essai de fonctionnement concluant" className={`${champ} resize-none`}
                />
              </div>

              <div>
                <span className={etiquette}>Pièces remplacées</span>
                {contenu.pieces.length === 0 ? (
                  <p className="text-sm text-gray-500">Aucune pièce identifiée sur cette carte.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {contenu.pieces.map((p) => (
                      <li key={p.cle}>
                        <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
                          <input
                            type="checkbox" checked={p.retenue} className="mt-0.5 h-4 w-4"
                            onChange={(e) => set('pieces')(contenu.pieces.map((x) => (x.cle === p.cle ? { ...x, retenue: e.target.checked } : x)))}
                          />
                          <span>{p.quantite} × {p.designation}{p.reference ? <span className="text-gray-500"> · réf. {p.reference}</span> : null}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <label htmlFor="rs-observations" className={etiquette}>Observations</label>
                <textarea
                  id="rs-observations" rows={2} value={contenu.observations} onChange={(e) => set('observations')(e.target.value)}
                  placeholder="Conseil d'usage, point à surveiller…" className={`${champ} resize-none`}
                />
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t bg-gray-50 rounded-b-xl space-y-2">
          <p className="text-xs text-amber-700 min-h-[1rem]">{erreurs[0] || (email.visible ? motifEnvoi : '') || ''}</p>
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800">Fermer</button>
            {email.visible && (
              <button
                type="button" onClick={handleEnvoyer} disabled={Boolean(motifEnvoi) || envoiEnCours || edition}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border border-blue-600 text-blue-700 bg-white hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {envoiEnCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {trace?.envoye_le && aJour ? 'Renvoyer au client' : 'Envoyer au client'}
              </button>
            )}
            <button
              type="button" onClick={handleEditer} disabled={!contenu || erreurs.length > 0 || edition || envoiEnCours || aJour}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {edition ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {trace ? 'Mettre à jour le rapport' : 'Éditer le rapport'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default RapportSavDialog;
