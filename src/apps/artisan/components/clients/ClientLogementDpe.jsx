/**
 * ClientLogementDpe.jsx — Le logement du client vu par MonsieurDPE (bloc Logement de la fiche)
 * ============================================================================
 * Spec : docs/superpowers/specs/2026-11-12-logement-monsieurdpe-fiche-client-design.md
 *
 * À l'ouverture, une seule décision (`actionALouverture`) : rattacher le DPE à l'adresse (automatique quand c'est
 * sûr, candidats sinon), relire la carte, ou rien. La carte est lue dans `client_dpe` : aucun appel au corpus à
 * l'ouverture suivante. Le numéro de référence est celui ENREGISTRÉ sur la fiche (`client.dpe_number`), jamais
 * une saisie en cours. Ne rend rien si le module `dpe` n'est pas ouvert.
 * ============================================================================
 */
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2, ExternalLink, Copy, FileSearch, RefreshCw, Send, Search, ClipboardCheck, Undo2, MapPinned,
} from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useCanAccess } from '@hooks/usePermissions';
import { useDpeLien } from '@hooks/useDpeLien';
import { moduleActif } from '@lib/modules';
import { toClientPatch } from '@lib/dpeApi';
import {
  formaterCandidats, messageErreurDpeLien, lienObservatoire, actionALouverture, adresseNormalisee, disponibiliteEnvoi,
  etatDuBloc,
} from '@lib/dpeLien';
import { formatDateShortFR } from '@lib/utils';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { DpeLogementCard } from './DpeLogementCard';

const BOUTON = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-secondary-300 text-secondary-700 bg-white hover:bg-secondary-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const BOUTON_PRINCIPAL = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const LIEN = 'text-xs font-medium text-primary-700 hover:underline disabled:opacity-50 disabled:no-underline';

const ORIGINES = {
  auto: 'Rattaché automatiquement à l’adresse',
  choisi: 'Choisi par votre équipe',
  saisi: 'Numéro saisi sur la fiche',
};
const PATCH_LABELS = { surface: 'surface', housingType: 'type' };

function Cadre({ children }) {
  return <div className="mt-4 rounded-lg border border-secondary-200 bg-secondary-50/60 p-4 space-y-3">{children}</div>;
}
function Titre({ children }) {
  return <p className="text-sm font-medium text-secondary-900">{children}</p>;
}

export function ClientLogementDpe({ client, formHousingType, formSurface, onApply, onCreateEquipment, onRechercherVoisinage }) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { settings } = useOrgSettings();
  const { can } = useCanAccess();
  const actif = moduleActif(settings, 'dpe');
  const peutModifier = can('clients', 'edit');
  const clientId = client?.id;

  const {
    ligne, ligneChargee, ligneErreur, acces, rattacher, choisir, detacher, actualiser, ouvrir, envoyer,
    enCours, isOpening, isSending,
  } = useDpeLien({ orgId, clientId, actif });

  const adresseFiche = adresseNormalisee(client);
  const numeroFiche = (client?.dpe_number || '').trim();
  const decision = ligneChargee
    ? actionALouverture({ adresseFiche, dpeNumberFiche: numeroFiche, peutModifier, clientDpe: ligne })
    : 'rien';

  // Une même décision ne part qu'une fois par montage (pas de boucle si l'edge échoue).
  const dejaFait = useRef(new Set());
  useEffect(() => {
    if (!actif || (decision !== 'rattacher' && decision !== 'actualiser') || enCours) return;
    const cle = `${decision}|${numeroFiche}|${adresseFiche}`;
    if (dejaFait.current.has(cle)) return;
    dejaFait.current.add(cle);
    (decision === 'rattacher' ? rattacher() : actualiser()).catch((e) => toast.error(messageErreurDpeLien(e)));
  }, [actif, decision, numeroFiche, adresseFiche, enCours, rattacher, actualiser]);

  const [confirmerEnvoi, setConfirmerEnvoi] = useState(false);

  if (!actif || !clientId || !orgId) return null;

  const geste = (fn, succes) => async (...args) => {
    try {
      await fn(...args);
      if (succes) toast.success(succes);
    } catch (e) {
      toast.error(messageErreurDpeLien(e));
    }
  };

  const obtenirLien = async (forcer = false) => {
    if (!forcer && acces?.report_url) return acces.report_url;
    const data = await ouvrir({ forcer });
    if (!data?.url) throw new Error('partenaire_indisponible');
    return data.url;
  };
  const ouvrirAnalyse = async () => {
    // L'onglet s'ouvre AVANT l'appel : après un await, le navigateur le bloquerait.
    const onglet = window.open('', '_blank');
    if (onglet) onglet.opener = null;
    try {
      const url = await obtenirLien();
      if (onglet) onglet.location.href = url;
      else toast.error("Le navigateur a bloqué l'ouverture de l'analyse : autorisez les fenêtres pour ce site, ou utilisez « Copier le lien ».");
    } catch (e) {
      onglet?.close();
      toast.error(messageErreurDpeLien(e));
    }
  };
  const copierLien = async () => {
    try {
      await navigator.clipboard.writeText(await obtenirLien());
      toast.success("Lien de l'analyse copié");
    } catch (e) {
      toast.error(e?.name === 'NotAllowedError' ? 'Le navigateur a refusé la copie du lien' : messageErreurDpeLien(e));
    }
  };
  const envoyerAuClient = async () => {
    try {
      const r = await envoyer();
      setConfirmerEnvoi(false);
      toast.success(`Analyse envoyée à ${r?.to || 'votre client'}`);
    } catch (e) {
      toast.error(messageErreurDpeLien(e));
    }
  };

  const etat = etatDuBloc({ ligne, numeroFiche });

  // ---------------------------------------------------------------- chargement / pas d'adresse
  if (!ligneChargee || (enCours && etat !== 'carte')) {
    return (
      <Cadre>
        <p className="flex items-center gap-2 text-sm text-secondary-500">
          {ligneErreur ? "Les données MonsieurDPE n'ont pas pu être lues. Rechargez la fiche." : (
            <><Loader2 className="w-4 h-4 animate-spin" /> Recherche du DPE du logement…</>
          )}
        </p>
      </Cadre>
    );
  }
  if (etat === 'vide' && !ligne && !adresseFiche) {
    return <Cadre><p className="text-sm text-secondary-500">Renseignez l’adresse du client pour retrouver le DPE de son logement.</p></Cadre>;
  }

  const record = etat === 'carte' ? ligne.carte : null;

  // ---------------------------------------------------------------- DPE rattaché : la carte
  if (record) {
    const patch = toClientPatch(record);
    const aRenseigner = Object.keys(patch).filter((k) =>
      (k === 'surface' && !String(formSurface || '').trim()) || (k === 'housingType' && !formHousingType));
    const envoi = disponibiliteEnvoi({
      communicationActive: moduleActif(settings, 'communication'),
      peutModifier,
      emailClient: client?.email,
      rapportComplet: ligne.rapport_complet === true,
      expediteurConfigure: Boolean((settings?.from_email || '').trim()) && settings?.resend?.status === 'verified',
    });
    const entete = (
      <div className="space-y-1.5">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary-500">
          <span>
            {ORIGINES[ligne.origine] || 'DPE rattaché'}
            {ligne.voisinage ? ' · trouvé dans le voisinage' : ''}
            {ligne.lu_le ? ` · lu le ${formatDateShortFR(ligne.lu_le)}` : ''}
          </span>
          {peutModifier && (
            <>
              <button type="button" className={LIEN} disabled={enCours} onClick={geste(detacher, 'DPE retiré de la fiche')}>
                <Undo2 className="inline w-3 h-3 mr-0.5" />Ce n’est pas le bon
              </button>
              <button type="button" className={LIEN} disabled={enCours} onClick={geste(actualiser, 'Carte mise à jour')}>
                <RefreshCw className={`inline w-3 h-3 mr-0.5 ${enCours ? 'animate-spin' : ''}`} />Mettre à jour
              </button>
              {acces?.report_url && (
                <button type="button" className={LIEN} disabled={isOpening} onClick={geste(() => obtenirLien(true), "Lien de l'analyse régénéré")} title="À utiliser si le lien de l'analyse ne s'ouvre plus">
                  Régénérer le lien
                </button>
              )}
            </>
          )}
        </p>
        {decision === 'signaler_adresse' && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            L’adresse du client a changé depuis le rattachement de ce DPE : vérifiez qu’il s’agit toujours du bon logement.
          </p>
        )}
        {ligne.rapport_complet === false && (
          <p className="text-xs text-secondary-500">{messageErreurDpeLien('sans_rapport_complet')}</p>
        )}
      </div>
    );
    const actions = (
      <>
        {peutModifier && aRenseigner.length > 0 && onApply && (
          <button type="button" className={BOUTON} onClick={() => onApply(Object.fromEntries(aRenseigner.map((k) => [k, patch[k]])))}
            title={`Renseigne ${aRenseigner.map((k) => PATCH_LABELS[k]).join(', ')} dans la fiche`}>
            <ClipboardCheck className="w-3.5 h-3.5" />Renseigner la fiche
          </button>
        )}
        {ligne.rapport_complet === true && (peutModifier || acces?.report_url) && (
          <>
            <button type="button" className={BOUTON} onClick={copierLien} disabled={isOpening}>
              <Copy className="w-3.5 h-3.5" />Copier le lien
            </button>
            <button type="button" className={BOUTON} onClick={ouvrirAnalyse} disabled={isOpening}>
              {isOpening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSearch className="w-3.5 h-3.5" />}
              Analyse MonsieurDPE
            </button>
          </>
        )}
        {envoi.visible && (
          <button type="button" className={BOUTON_PRINCIPAL} onClick={() => setConfirmerEnvoi(true)} disabled={!envoi.actif || isSending}
            title={envoi.raison || "Envoyer au client l'analyse complète en PDF"}>
            <Send className="w-3.5 h-3.5" />Envoyer au client
          </button>
        )}
      </>
    );
    return (
      <div className="mt-4 space-y-2">
        <Titre>Le logement selon son DPE · MonsieurDPE</Titre>
        <DpeLogementCard record={record} entete={entete} actions={actions} onCreateEquipment={peutModifier ? onCreateEquipment : undefined} />
        {envoi.visible && !envoi.actif && <p className="text-xs text-secondary-500">{envoi.raison}</p>}
        <ConfirmDialog
          open={confirmerEnvoi}
          onOpenChange={setConfirmerEnvoi}
          variant="default"
          title="Envoyer l’analyse au client"
          description={`L’analyse complète MonsieurDPE du logement (DPE ${ligne.dpe_number}) part en PDF à ${client?.email || ''}, depuis l’adresse de votre entreprise, avec le modèle « Rapport MonsieurDPE ».`}
          confirmLabel="Envoyer"
          loading={isSending}
          onConfirm={envoyerAuClient}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------- un numéro, mais pas (encore) sa carte
  if (etat === 'carte_indisponible' || etat === 'lecture') {
    const numeroAffiche = numeroFiche || ligne?.dpe_number || '';
    return (
      <Cadre>
        <Titre>DPE n° {numeroAffiche}</Titre>
        <p className="text-sm text-secondary-600">
          {etat === 'carte_indisponible'
            ? `${ORIGINES[ligne?.origine] || 'DPE rattaché'}. Sa carte n’est pas disponible : ${messageErreurDpeLien(ligne?.carte_erreur)}`
            : 'La carte de ce DPE n’a pas encore été lue.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {lienObservatoire(numeroAffiche) && (
            <a href={lienObservatoire(numeroAffiche)} target="_blank" rel="noopener noreferrer" className={BOUTON}>
              <ExternalLink className="w-3.5 h-3.5" />Voir le DPE
            </a>
          )}
          {peutModifier && (
            <button type="button" className={BOUTON} disabled={enCours} onClick={geste(actualiser, 'Carte mise à jour')}>
              <RefreshCw className={`w-3.5 h-3.5 ${enCours ? 'animate-spin' : ''}`} />Mettre à jour
            </button>
          )}
          {peutModifier && etat === 'carte_indisponible' && (
            <button type="button" className={BOUTON} disabled={enCours} onClick={geste(detacher, 'DPE retiré de la fiche')}>
              <Undo2 className="w-3.5 h-3.5" />Ce n’est pas le bon
            </button>
          )}
        </div>
      </Cadre>
    );
  }

  // ---------------------------------------------------------------- pas de numéro : candidats, rien, erreur
  const resultat = formaterCandidats({ candidats: ligne?.candidats || [] });
  const voisinage = onRechercherVoisinage && (
    <button type="button" className={BOUTON} onClick={onRechercherVoisinage}>
      <MapPinned className="w-3.5 h-3.5" />Chercher dans les DPE publics
    </button>
  );
  const relancer = peutModifier && (
    <button type="button" className={BOUTON} onClick={geste(rattacher)} disabled={enCours}>
      {enCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
      Relancer la recherche
    </button>
  );

  if (etat === 'candidats' && resultat.candidats.length > 0) {
    return (
      <Cadre>
        <Titre>{resultat.candidats.length > 1 ? 'Plusieurs DPE possibles pour ce logement' : 'Un DPE à confirmer'}</Titre>
        <p className="text-xs text-secondary-500">
          {resultat.candidats.length > 1
            ? 'Le bâtiment porte plusieurs DPE : choisissez celui du logement du client.'
            : 'Un DPE a été trouvé à l’adresse du client : confirmez que c’est bien son logement.'}
          {resultat.indistinguables && ' Plusieurs se ressemblent : ouvrez-les sur l’observatoire ADEME pour vérifier l’étage ou le nom.'}
        </p>
        <ul className="divide-y divide-secondary-200 rounded-lg border border-secondary-200 bg-white">
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
                <a href={lienObservatoire(c.numero)} target="_blank" rel="noopener noreferrer" className={BOUTON}>
                  <ExternalLink className="w-3.5 h-3.5" />Voir le DPE
                </a>
                {peutModifier && (
                  <button type="button" className={BOUTON_PRINCIPAL} disabled={enCours}
                    onClick={geste(() => choisir({ numero: c.numero }), `DPE ${c.numero} rattaché`)}>
                    C’est ce logement
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">{relancer}{voisinage}</div>
      </Cadre>
    );
  }

  const messages = {
    erreur: 'La recherche du DPE n’a pas abouti (service indisponible). Réessayez dans quelques minutes.',
    adresse_non_trouvee: 'L’adresse du client n’a pas été reconnue par la Base Adresse Nationale.',
    detache: 'Aucun DPE rattaché à cette fiche.',
  };
  return (
    <Cadre>
      <Titre>MonsieurDPE</Titre>
      <p className="text-sm text-secondary-600">
        {messages[ligne?.etat] || 'Aucun DPE connu pour ce logement. C’est courant : un DPE n’existe que si le logement a été vendu, loué ou audité depuis 2021.'}
      </p>
      <div className="flex flex-wrap gap-2">{relancer}{voisinage}</div>
    </Cadre>
  );
}
