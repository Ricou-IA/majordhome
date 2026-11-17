/**
 * PvReception.jsx — page publique /pv/:token
 * ============================================================================
 * Le client signe le procès-verbal de réception de ses travaux depuis le lien reçu
 * par e-mail (ou transmis par le bureau). Pas de compte : le jeton du lien désigne
 * le chantier (edge `chantier-pv`, HMAC). Pensée pour un téléphone.
 *
 * Ce que la page reçoit : l'entreprise, le nom et l'adresse du client, l'objet et
 * les jours de pose. Ni montant, ni note interne.
 * Règles (validation, messages, données du PDF) : src/lib/pvReception.js.
 * Spec : docs/superpowers/specs/2026-11-17-chantier-apres-vente-pv-en-ligne-design.md
 * ============================================================================
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Download, Loader2 } from 'lucide-react';
import { CertificatSignaturePad } from '@apps/artisan/components/certificat/CertificatSignaturePad';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { downloadBlob } from '@/lib/utils';
import {
  validerReponsePv, normaliserReponsePv, messagePv, periodeDePose, dateLongue, jourDeParis, donneesPdfPv,
} from '@/lib/pvReception';

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chantier-pv`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function appelerEdge({ method = 'GET', token, body }) {
  const url = method === 'GET' ? `${EDGE_URL}?token=${encodeURIComponent(token)}` : EDGE_URL;
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(ANON_KEY ? { apikey: ANON_KEY } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

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

/** Ce que le client vient de signer (ou a signé plus tôt), et son PDF. */
function Recapitulatif({ pv }) {
  const [telechargement, setTelechargement] = useState(false);
  const [erreur, setErreur] = useState(null);
  const signature = pv.signature;
  const avecReserves = signature?.reception_type === 'avec_reserves';

  const telecharger = async () => {
    setTelechargement(true);
    setErreur(null);
    try {
      const company = buildCompanyInfo(pv.entreprise);
      // react-pdf est lourd : chargé seulement si le client demande son PDF.
      const { generatePvReceptionPdfBlob } = await import('@apps/artisan/components/chantiers/PvReceptionPDF');
      const blob = await generatePvReceptionPdfBlob(donneesPdfPv({
        chantierId: pv.chantier_id, client: pv.client, objet: pv.objet, entreprise: company.name, signature,
      }), company);
      downloadBlob(blob, 'PV_de_reception.pdf');
    } catch {
      setErreur('Le PDF n’a pas pu être préparé. Votre signature est bien enregistrée : demandez-nous une copie.');
    } finally {
      setTelechargement(false);
    }
  };

  return (
    <section className="mt-8 space-y-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-base font-semibold">Votre procès-verbal de réception est signé.</p>
          <p className="text-sm text-secondary-600">Merci{pv.client?.prenom ? ` ${pv.client.prenom}` : ''}. Nous en avons été informés.</p>
        </div>
      </div>

      {signature && (
        <dl className="rounded-lg border border-secondary-200 bg-white p-4 text-sm space-y-2">
          <div><dt className="text-secondary-500">Travaux</dt><dd className="font-medium">{pv.objet}</dd></div>
          <div><dt className="text-secondary-500">Signé le</dt><dd className="font-medium">{dateLongue(jourDeParis(signature.signed_at))} par {signature.signataire_nom}</dd></div>
          <div>
            <dt className="text-secondary-500">Réception</dt>
            <dd className="font-medium">{avecReserves ? 'Avec réserves' : 'Sans réserve'}</dd>
          </div>
          {avecReserves && signature.reserves_nature && (
            <div><dt className="text-secondary-500">Réserves signalées</dt><dd className="whitespace-pre-line">{signature.reserves_nature}</dd></div>
          )}
          {avecReserves && signature.reserves_travaux && (
            <div><dt className="text-secondary-500">Travaux à exécuter</dt><dd className="whitespace-pre-line">{signature.reserves_travaux}</dd></div>
          )}
        </dl>
      )}

      {avecReserves && (
        <p className="text-sm text-secondary-700">Nous revenons vers vous au sujet de vos réserves.</p>
      )}

      {signature && (
        <button
          type="button"
          onClick={telecharger}
          disabled={telechargement}
          className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-lg border border-secondary-300 bg-white text-base font-medium text-secondary-800 hover:bg-secondary-100 disabled:opacity-60"
        >
          {telechargement ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
          Télécharger mon procès-verbal (PDF)
        </button>
      )}
      {erreur && <p className="text-sm text-amber-800">{erreur}</p>}
      <p className="text-xs text-secondary-500">Document à conserver 10 ans : il fait courir les garanties légales de votre installation.</p>
    </section>
  );
}

const RECU = [
  { cle: 'info_recues', texte: 'Les informations nécessaires au fonctionnement des matériels installés' },
  { cle: 'notices_recues', texte: 'Les notices d’utilisation en français des matériels installés' },
  { cle: 'entretien_recues', texte: 'Les informations relatives à l’entretien et à la maintenance des matériels installés' },
];

export default function PvReception() {
  const { token } = useParams();
  const [etat, setEtat] = useState('chargement'); // chargement · erreur · formulaire · envoi · signe
  const [pv, setPv] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [refus, setRefus] = useState(null);

  const [reponse, setReponse] = useState({
    reception_type: null, reserves_nature: '', reserves_travaux: '',
    info_recues: false, notices_recues: false, entretien_recues: false,
    signataire_nom: '', signature_png: null,
  });
  const maj = (patch) => { setRefus(null); setReponse((r) => ({ ...r, ...patch })); };

  const charger = useCallback(async () => {
    setEtat('chargement');
    const { ok, json } = await appelerEdge({ token });
    if (!ok) {
      setErreur(json?.error || 'indisponible');
      setEtat('erreur');
      return;
    }
    setPv(json);
    setReponse((r) => ({
      ...r,
      signataire_nom: r.signataire_nom || [json.client?.prenom, json.client?.nom].filter(Boolean).join(' '),
    }));
    setEtat(json.deja_signe ? 'signe' : 'formulaire');
  }, [token]);

  useEffect(() => { charger(); }, [charger]);

  const adresse = useMemo(() => {
    const c = pv?.client || {};
    return [c.adresse, [c.code_postal, c.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }, [pv]);

  const signer = async () => {
    const code = validerReponsePv(reponse);
    if (code) {
      setRefus(messagePv(code));
      return;
    }
    setEtat('envoi');
    const { ok, status, json } = await appelerEdge({
      method: 'POST', token, body: { action: 'signer', token, reponse: normaliserReponsePv(reponse) },
    });
    if (ok && json?.pv) {
      setPv(json.pv);
      setEtat('signe');
      return;
    }
    if (status === 409) { // déjà signé entre-temps : on réaffiche ce qui est enregistré
      await charger();
      return;
    }
    setRefus(messagePv(json?.error, 'Votre signature n’a pas pu être enregistrée. Réessayez dans un instant.'));
    setEtat('formulaire');
  };

  const entreprise = pv?.entreprise;
  const avecReserves = reponse.reception_type === 'avec_reserves';
  const pose = periodeDePose(pv?.poses);

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

        {etat === 'signe' && pv && <Recapitulatif pv={pv} />}

        {(etat === 'formulaire' || etat === 'envoi') && pv && (
          <section className="mt-6 space-y-6">
            <div className="space-y-2">
              <p className="text-base">Bonjour{pv.client?.prenom ? ` ${pv.client.prenom}` : ''},</p>
              <p className="text-base">
                Votre installation est terminée. Merci de confirmer la réception des travaux : votre signature
                fait courir les garanties.
              </p>
            </div>

            <dl className="rounded-lg border border-secondary-200 bg-white p-4 text-sm space-y-2">
              <div><dt className="text-secondary-500">Travaux</dt><dd className="font-medium">{pv.objet}</dd></div>
              {pose && <div><dt className="text-secondary-500">Réalisés</dt><dd className="font-medium">{pose}</dd></div>}
              {adresse && <div><dt className="text-secondary-500">Adresse</dt><dd className="font-medium">{adresse}</dd></div>}
            </dl>

            <fieldset className="space-y-3" disabled={etat === 'envoi'}>
              <legend className="text-sm font-semibold mb-1">Votre décision</legend>
              {[
                { valeur: 'sans_reserves', titre: 'Je réceptionne les travaux sans réserve', aide: 'Les travaux sont terminés et conformes.' },
                { valeur: 'avec_reserves', titre: 'Je réceptionne les travaux avec des réserves', aide: 'Des points restent à corriger : je les décris ci-dessous.' },
              ].map((choix) => (
                <label
                  key={choix.valeur}
                  className={`flex items-start gap-3 p-3 rounded-lg border bg-white cursor-pointer ${
                    reponse.reception_type === choix.valeur ? 'border-secondary-900 ring-1 ring-secondary-900' : 'border-secondary-300'
                  }`}
                >
                  <input
                    type="radio" name="reception_type" className="mt-1 h-4 w-4"
                    checked={reponse.reception_type === choix.valeur}
                    onChange={() => maj({ reception_type: choix.valeur })}
                  />
                  <span>
                    <span className="block text-base font-medium">{choix.titre}</span>
                    <span className="block text-sm text-secondary-600">{choix.aide}</span>
                  </span>
                </label>
              ))}

              {avecReserves && (
                <div className="space-y-3">
                  <label className="block">
                    <span className="block text-sm font-medium mb-1">Vos réserves <span className="text-red-600">*</span></span>
                    <textarea
                      rows={3} maxLength={2000} value={reponse.reserves_nature}
                      onChange={(e) => maj({ reserves_nature: e.target.value })}
                      placeholder="Décrivez ce qui ne va pas"
                      className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-base bg-white"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium mb-1">Ce que vous attendez</span>
                    <textarea
                      rows={2} maxLength={2000} value={reponse.reserves_travaux}
                      onChange={(e) => maj({ reserves_travaux: e.target.value })}
                      placeholder="Travaux à reprendre ou à terminer (facultatif)"
                      className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-base bg-white"
                    />
                  </label>
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-2" disabled={etat === 'envoi'}>
              <legend className="text-sm font-semibold mb-1">Je reconnais avoir reçu</legend>
              {RECU.map((item) => (
                <label key={item.cle} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox" className="mt-1 h-4 w-4 rounded"
                    checked={reponse[item.cle]}
                    onChange={(e) => maj({ [item.cle]: e.target.checked })}
                  />
                  <span className="text-sm text-secondary-800">{item.texte}</span>
                </label>
              ))}
            </fieldset>

            <div>
              <CertificatSignaturePad
                onSign={(image) => maj({ signature_png: image })}
                onClear={() => maj({ signature_png: null })}
                signataireNom={reponse.signataire_nom}
                onSignataireNomChange={(nom) => maj({ signataire_nom: nom })}
                existingSignature={reponse.signature_png}
                isSaving={etat === 'envoi'}
                nomLabel="Votre nom et prénom"
                signatureLabel="Votre signature"
                placeholder="Signez ici, au doigt"
                disclaimerText="En signant, vous reconnaissez avoir réceptionné les travaux dans les conditions décrites ci-dessus."
              />
            </div>

            {refus && (
              <p className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3" role="alert">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                {refus}
              </p>
            )}

            <button
              type="button"
              onClick={signer}
              disabled={etat === 'envoi'}
              className="w-full min-h-[52px] inline-flex items-center justify-center gap-2 rounded-lg text-base font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: entreprise?.accent_color || '#334155' }}
            >
              {etat === 'envoi' ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {etat === 'envoi' ? 'Enregistrement…' : 'Signer le procès-verbal'}
            </button>
          </section>
        )}

        <Pied entreprise={entreprise} />
      </main>
    </div>
  );
}
