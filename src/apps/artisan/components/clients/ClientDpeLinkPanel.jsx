import { useState } from 'react';
import { Search, Loader2, ExternalLink, Copy, FileSearch, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useCanAccess } from '@hooks/usePermissions';
import { useClient } from '@hooks/useClients';
import { useDpeLien } from '@hooks/useDpeLien';
import { moduleActif } from '@lib/modules';
import { formaterCandidats, messageErreurDpeLien, etatDuLien, lienObservatoire } from '@lib/dpeLien';
import { formatDateShortFR } from '@lib/utils';

/**
 * Lien MonsieurDPE sur la fiche client (bloc Logement).
 * Spec : docs/superpowers/specs/2026-11-11-lien-monsieurdpe-fiche-client-design.md
 *
 * Trois gestes : rechercher les DPE du bâtiment à l'adresse du client, CONFIRMER lequel est le sien (jamais de
 * présélection : le DPE du voisin présenté comme celui du client est le piège à éviter), puis ouvrir ou copier
 * le lien de l'analyse complète MonsieurDPE. Le composant travaille sur le numéro ENREGISTRÉ (`savedDpeNumber`),
 * celui que l'edge function relit en base — pas sur une saisie en cours dans le formulaire.
 *
 * Ne rend rien si le module `dpe` n'est pas ouvert pour l'organisation.
 */
export function ClientDpeLinkPanel({ clientId, savedDpeNumber, formDpeNumber, adresseComplete, onDpeNumberSaved }) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { settings } = useOrgSettings();
  const { can } = useCanAccess();
  const actif = moduleActif(settings, 'dpe');
  const peutModifier = can('clients', 'edit');

  const { updateClient, isUpdating } = useClient(actif ? clientId : null);
  const numero = (savedDpeNumber || '').trim();
  const {
    acces, accesEnCours, accesErreur, verification, verificationErreur, isVerifying, reverifier,
    chercher, isSearching, ouvrir, isOpening,
  } = useDpeLien({ orgId, clientId, dpeNumber: numero, actif, peutVerifier: peutModifier });

  const [resultat, setResultat] = useState(null);

  if (!actif || !clientId || !orgId) return null;

  const etat = etatDuLien({ dpeNumber: numero, verification, acces });
  const saisieNonEnregistree = (formDpeNumber || '').trim() !== numero;

  const rechercher = async () => {
    try {
      setResultat(formaterCandidats(await chercher()));
    } catch (e) {
      toast.error(messageErreurDpeLien(e));
    }
  };

  const confirmer = async (candidat) => {
    try {
      await updateClient({ dpeNumber: candidat.numero });
      onDpeNumberSaved?.(candidat.numero);
      setResultat(null);
      toast.success(`DPE ${candidat.numero} rattaché à la fiche`);
    } catch {
      toast.error("Le numéro de DPE n'a pas pu être enregistré sur la fiche");
    }
  };

  /** Le lien du rapport : relu s'il est déjà émis, émis sinon (droit clients.edit). */
  const obtenirLien = async () => {
    if (acces?.report_url) return acces.report_url;
    const data = await ouvrir();
    return data?.url || null;
  };

  const ouvrirAnalyse = async () => {
    // L'onglet s'ouvre AVANT l'appel : après un await, le navigateur le bloquerait comme une fenêtre surgissante.
    const onglet = window.open('', '_blank');
    if (onglet) onglet.opener = null;
    try {
      const url = await obtenirLien();
      if (!url) throw new Error('partenaire_indisponible');
      if (onglet) {
        onglet.location.href = url;
      } else {
        // Fenêtre bloquée par le navigateur : on ne quitte PAS la fiche (saisie en cours perdue), on le dit.
        toast.error("Le navigateur a bloqué l'ouverture de l'analyse : autorisez les fenêtres pour ce site, ou utilisez « Copier le lien ».");
      }
    } catch (e) {
      onglet?.close();
      toast.error(messageErreurDpeLien(e));
    }
  };

  /** Redemande le lien à MonsieurDPE (accès révoqué de leur côté, lien qui ne s'ouvre plus). */
  const regenererLien = async () => {
    try {
      await ouvrir({ forcer: true });
      toast.success("Lien de l'analyse régénéré");
    } catch (e) {
      toast.error(messageErreurDpeLien(e));
    }
  };

  const copierLien = async () => {
    try {
      const url = await obtenirLien();
      if (!url) throw new Error('partenaire_indisponible');
      await navigator.clipboard.writeText(url);
      toast.success('Lien de l\'analyse copié : vous pouvez l\'envoyer au client');
    } catch (e) {
      toast.error(e?.name === 'NotAllowedError' ? 'Le navigateur a refusé la copie du lien' : messageErreurDpeLien(e));
    }
  };

  const boutonSecondaire = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-secondary-300 text-secondary-700 bg-white hover:bg-secondary-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
  const boutonPrincipal = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

  const raisonRecherche = !peutModifier
    ? 'Réservé aux personnes qui peuvent modifier les fiches clients'
    : !adresseComplete
      ? "Enregistrez d'abord la rue et la commune du client"
      : 'Chercher les DPE du bâtiment à cette adresse dans le corpus MonsieurDPE';
  const peutOuvrir = etat === 'emis' || (etat === 'pret' && peutModifier);

  return (
    <div className="mt-4 rounded-lg border border-secondary-200 bg-secondary-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-secondary-900">MonsieurDPE</p>
          <p className="text-xs text-secondary-500">
            {etat === 'sans_numero' && 'Aucun DPE rattaché à cette fiche.'}
            {etat === 'mal_forme' && 'Le numéro enregistré ne fait pas 13 caractères.'}
            {etat === 'a_verifier' && (isVerifying || accesEnCours
              ? 'Vérification du numéro dans le corpus…'
              : accesErreur
                ? "L'état du lien n'a pas pu être lu. Rechargez la fiche."
                : verificationErreur
                  ? messageErreurDpeLien(verificationErreur)
                  : `DPE ${numero} enregistré.`)}
            {etat === 'absent_du_corpus' && messageErreurDpeLien('numero_absent')}
            {etat === 'sans_rapport_complet' && messageErreurDpeLien('sans_rapport_complet')}
            {etat === 'pret' && `DPE ${numero} retrouvé dans le corpus${verification?.resume?.etiquette ? ` · étiquette ${verification.resume.etiquette}` : ''}.`}
            {etat === 'emis' && `Analyse complète disponible pour le DPE ${numero}.`}
          </p>
          {saisieNonEnregistree && (
            <p className="mt-1 text-xs text-amber-700">Le numéro saisi n&apos;est pas encore enregistré : enregistrez la fiche pour l&apos;utiliser.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={boutonSecondaire} onClick={rechercher} disabled={!peutModifier || !adresseComplete || isSearching} title={raisonRecherche}>
            {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            {numero ? 'Rechercher un autre DPE' : 'Rechercher le DPE'}
          </button>
          {etat === 'a_verifier' && verificationErreur && !isVerifying && (
            <button type="button" className={boutonSecondaire} onClick={() => reverifier()}>
              <RefreshCw className="w-3.5 h-3.5" />
              Réessayer
            </button>
          )}
          {etat === 'emis' && peutModifier && (
            <button type="button" className={boutonSecondaire} onClick={regenererLien} disabled={isOpening} title="À utiliser si le lien de l'analyse ne s'ouvre plus">
              <RefreshCw className="w-3.5 h-3.5" />
              Régénérer le lien
            </button>
          )}
          {peutOuvrir && (
            <>
              <button type="button" className={boutonPrincipal} onClick={ouvrirAnalyse} disabled={isOpening}>
                {isOpening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSearch className="w-3.5 h-3.5" />}
                Analyse MonsieurDPE
              </button>
              <button type="button" className={boutonSecondaire} onClick={copierLien} disabled={isOpening} title="Copier le lien de l'analyse pour l'envoyer au client">
                <Copy className="w-3.5 h-3.5" />
                Copier le lien
              </button>
            </>
          )}
        </div>
      </div>

      {resultat && (
        <div className="mt-4 border-t border-secondary-200 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="text-xs text-secondary-600">
              <p>
                <span className="font-medium text-secondary-800">Adresse retenue par la recherche : </span>
                {resultat.adresseTrouvee || 'adresse non reconnue'}
              </p>
              <p className="mt-0.5 text-secondary-500">Comparez-la à l&apos;adresse du client avant de confirmer.</p>
            </div>
            <button type="button" onClick={() => setResultat(null)} className="p-1 text-secondary-400 hover:text-secondary-600" title="Fermer la recherche">
              <X className="w-4 h-4" />
            </button>
          </div>

          {resultat.candidats.length === 0 ? (
            <p className="mt-3 text-sm text-secondary-700">
              Aucun DPE connu pour ce logement dans le corpus MonsieurDPE. C&apos;est courant : un DPE n&apos;existe que si le
              logement a été vendu, loué ou audité depuis 2021. Si le client a un DPE, saisissez son numéro dans le champ
              « N° DPE ADEME », ou utilisez « Investiguer » pour chercher dans le voisinage.
            </p>
          ) : (
            <>
              {resultat.indistinguables && (
                <p className="mt-3 text-xs text-amber-700">
                  Plusieurs DPE se ressemblent (même surface, même type). Ouvrez-les sur l&apos;observatoire ADEME pour vérifier
                  l&apos;étage ou le nom avant de confirmer.
                </p>
              )}
              <ul className="mt-3 divide-y divide-secondary-200 rounded-lg border border-secondary-200 bg-white">
                {resultat.candidats.map((c) => (
                  <li key={c.numero} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                    <div className="text-sm text-secondary-800">
                      <span className="font-medium">{c.date ? formatDateShortFR(c.date) : 'Date inconnue'}</span>
                      <span className="text-secondary-500">
                        {' · '}étiquette {c.etiquette || 'inconnue'}
                        {c.surface != null ? ` · ${String(c.surface).replace('.', ',')} m²` : ''}
                        {c.type ? ` · ${c.type}` : ''}
                      </span>
                      <span className="block text-xs text-secondary-400">N° {c.numero}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <a href={lienObservatoire(c.numero)} target="_blank" rel="noopener noreferrer" className={boutonSecondaire} title="Ouvrir ce DPE sur l'observatoire ADEME">
                        <ExternalLink className="w-3.5 h-3.5" />
                        Voir le DPE
                      </a>
                      <button type="button" className={boutonPrincipal} onClick={() => confirmer(c)} disabled={isUpdating || c.numero === numero}>
                        {c.numero === numero ? 'Déjà rattaché' : "C'est ce logement"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
