/**
 * PvReception.jsx — page publique /pv/:token
 * ============================================================================
 * Le client signe le procès-verbal de réception de ses travaux depuis le lien reçu
 * par e-mail (ou transmis par le bureau), puis, s'il y a eu des réserves, constate
 * leur levée avec le même lien. Pas de compte : le jeton du lien désigne le chantier
 * (edge `chantier-pv`, HMAC). Pensée pour un téléphone.
 *
 * Cette page assemble : état, appels à l'edge, section à montrer. Les sections sont
 * dans src/pages/pv/. Règles (validation, messages, PDF) : src/lib/pvReception.js.
 * La page ne reçoit ni montant, ni note interne, ni téléphone ou e-mail du client.
 * Spec : docs/superpowers/specs/2026-11-18-pv-reception-points-levee-reserves-design.md
 * ============================================================================
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  validerReponsePv, normaliserReponsePv, validerReponseLevee, messagePv,
} from '@/lib/pvReception';
import { appelerEdge, etatDepuisPv } from './pv/pvPageApi';
import PvFormulaire from './pv/PvFormulaire';
import PvRecapitulatif from './pv/PvRecapitulatif';
import PvLevee from './pv/PvLevee';

function Entete({ entreprise }) {
  const couleur = entreprise?.accent_color || '#64748b';
  return (
    <header className="flex items-center gap-3 pb-4 border-b" style={{ borderColor: couleur }}>
      {entreprise?.logo_url ? (
        <img src={entreprise.logo_url} alt="" className="h-10 w-auto object-contain" />
      ) : (
        <div className="h-10 w-10 rounded-full" style={{ backgroundColor: couleur }} />
      )}
      <div>
        <p className="text-sm text-secondary-500">Réception des travaux</p>
        <h1 className="text-lg font-semibold text-secondary-900">{entreprise?.brand_name || 'Votre installateur'}</h1>
      </div>
    </header>
  );
}

function Pied({ entreprise }) {
  if (!entreprise?.phone) return null;
  return (
    <footer className="mt-8 pt-4 border-t border-secondary-200 text-sm text-secondary-500">
      Une question ? Appelez-nous au{' '}
      <a href={`tel:${entreprise.phone.replace(/\s/g, '')}`} className="font-medium text-secondary-800 underline">{entreprise.phone}</a>.
    </footer>
  );
}

const REPONSE_VIERGE = {
  reception_type: null, reserves_nature: '', reserves_travaux: '', points_confirmes: [],
  signataire_nom: '', signature_png: null,
};

export default function PvReception() {
  const { token } = useParams();
  // chargement · erreur · pas_pret · formulaire · envoi · signe · levee · levee_signee · enregistre
  const [etat, setEtat] = useState('chargement');
  const [pv, setPv] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [refus, setRefus] = useState(null);
  const [reponse, setReponse] = useState(REPONSE_VIERGE);
  const maj = (patch) => { setRefus(null); setReponse((r) => ({ ...r, ...patch })); };

  const afficher = useCallback((json) => {
    setPv(json);
    setReponse((r) => ({
      ...r,
      signataire_nom: r.signataire_nom || [json.client?.prenom, json.client?.nom].filter(Boolean).join(' '),
    }));
    setEtat(etatDepuisPv(json));
  }, []);

  /** Relit le PV. `true` si la page a pu s'afficher. */
  const charger = useCallback(async () => {
    setEtat('chargement');
    const { ok, json } = await appelerEdge({ token });
    if (!ok) {
      setErreur(json?.error || 'indisponible');
      setEtat('erreur');
      return false;
    }
    afficher(json);
    return true;
  }, [token, afficher]);

  useEffect(() => { charger(); }, [charger]);

  /** Signature enregistrée : on montre ce que l'edge rend, sinon on relit ; à défaut, une confirmation neutre. */
  const apresEnregistrement = async (json) => {
    if (json?.pv) { afficher(json.pv); return; }
    const { ok, json: relu } = await appelerEdge({ token });
    if (ok) afficher(relu); else setEtat('enregistre');
  };

  const signer = async () => {
    const code = validerReponsePv(reponse);
    if (code) {
      setRefus(messagePv(code));
      return;
    }
    setEtat('envoi');
    const { ok, status, json } = await appelerEdge({
      method: 'POST', token,
      // `prepare_at` : la version lue, renvoyée telle quelle (après la normalisation, qui l'ignore).
      body: { action: 'signer', token, reponse: { ...normaliserReponsePv(reponse), prepare_at: pv.prepare_at } },
    });
    if (ok) { await apresEnregistrement(json); return; }
    const refusServeur = json?.error;
    if (status === 409 && (refusServeur === 'pv_modifie' || refusServeur === 'point_inconnu')) {
      // La déclaration a changé : le client relit, rien n'est renvoyé tout seul.
      const relu = await charger();
      if (relu) {
        setReponse((r) => ({ ...r, reception_type: null, points_confirmes: [], signature_png: null }));
        setRefus(messagePv(refusServeur));
      }
      return;
    }
    if (status === 409 && refusServeur === 'deja_signe') { // signé entre-temps : on réaffiche l'enregistré
      await charger();
      return;
    }
    setRefus(messagePv(refusServeur, 'Votre signature n’a pas pu être enregistrée. Réessayez dans un instant.'));
    setEtat('formulaire');
  };

  const signerLevee = async ({ signataire_nom, signature_png }) => {
    const code = validerReponseLevee({ signataire_nom, signature_png });
    if (code) return messagePv(code);
    const { ok, status, json } = await appelerEdge({
      method: 'POST', token, body: { action: 'signer_levee', token, reponse: { signataire_nom, signature_png } },
    });
    if (ok) { await apresEnregistrement(json); return null; }
    if (status === 409 && json?.error === 'levee_deja_signee') { await charger(); return null; }
    return messagePv(json?.error, 'Votre signature n’a pas pu être enregistrée. Réessayez dans un instant.');
  };

  const entreprise = pv?.entreprise;

  return (
    <div className="min-h-screen bg-secondary-50 text-secondary-900">
      <main className="max-w-md mx-auto p-4 sm:p-6">
        <Entete entreprise={entreprise} />

        {etat === 'chargement' && (
          <p className="mt-8 text-center text-secondary-500">Chargement de votre procès-verbal…</p>
        )}

        {etat === 'erreur' && (
          <section className="mt-8 space-y-3">
            <p className="text-base font-medium">{messagePv(erreur, 'Ce procès-verbal est momentanément indisponible.')}</p>
            <p className="text-sm text-secondary-600">Contactez votre installateur : il vous renverra un lien.</p>
          </section>
        )}

        {etat === 'pas_pret' && (
          <section className="mt-8 space-y-3">
            <p className="text-base font-medium">Ce procès-verbal n’est pas encore prêt.</p>
            <p className="text-sm text-secondary-600">Votre installateur vous renverra le lien dès qu’il le sera.</p>
          </section>
        )}

        {etat === 'enregistre' && (
          <section className="mt-8 space-y-3">
            <p className="text-base font-medium">Votre signature est enregistrée.</p>
            <button
              type="button" onClick={charger}
              className="w-full min-h-[48px] rounded-lg border border-secondary-300 bg-white text-base font-medium text-secondary-800 hover:bg-secondary-100"
            >
              Recharger
            </button>
          </section>
        )}

        {(etat === 'signe' || etat === 'levee_signee') && pv && <PvRecapitulatif pv={pv} etat={etat} />}

        {etat === 'levee' && pv && (
          <PvRecapitulatif pv={pv} etat="levee">
            <PvLevee client={pv.client} entreprise={entreprise} onSigner={signerLevee} />
          </PvRecapitulatif>
        )}

        {(etat === 'formulaire' || etat === 'envoi') && pv && (
          <PvFormulaire pv={pv} reponse={reponse} maj={maj} envoi={etat === 'envoi'} refus={refus} onSigner={signer} />
        )}

        <Pied entreprise={entreprise} />
      </main>
    </div>
  );
}
