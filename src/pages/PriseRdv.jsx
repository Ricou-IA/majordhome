/**
 * PriseRdv.jsx — page publique de prise de rendez-vous d'entretien (/rdv/:token)
 * ============================================================================
 * Spec 2026-09-29 « auto-RDV d'entretien mensuel » § 4.2. Sans compte, sans
 * session : la page ne parle qu'à l'edge `auto-rdv` avec le jeton de l'URL.
 * Les demi-journées sont calculées à l'ouverture sur le planning du moment,
 * jamais figées dans un mail ; la pose est atomique côté serveur et, si la
 * demi-journée s'est remplie entre-temps, la page recharge les créneaux.
 * Le client ne voit que : sa date, matin / après-midi, le prénom du technicien.
 * ============================================================================
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-rdv`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const LIBELLE_DEMI = { matin: 'Matin', apres_midi: 'Après-midi' };
const PLAGE_DEMI = { matin: '8 h – 12 h', apres_midi: '13 h – 18 h' };

const MESSAGES_ERREUR = {
  token_expired: 'Ce lien a expiré.',
  signature_mismatch: 'Ce lien n’est pas valide.',
  invalid_token: 'Ce lien n’est pas valide.',
  contrat_introuvable: 'Nous ne retrouvons pas votre contrat.',
  contrat_inactif: 'Votre contrat n’est plus actif.',
  client_non_localise: 'Nous n’avons pas votre adresse exacte.',
  siege_non_configure: 'La prise de rendez-vous en ligne n’est pas encore ouverte.',
  too_many_requests: 'Trop de tentatives, réessayez dans quelques minutes.',
};

function formatDateLongue(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

async function appelerEdge({ method = 'GET', token, body }) {
  const url = method === 'GET' ? `${EDGE_URL}?token=${encodeURIComponent(token)}` : EDGE_URL;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(ANON_KEY ? { apikey: ANON_KEY } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { ok: res.ok, status: res.status, json };
}

function Entete({ org }) {
  return (
    <header className="flex items-center gap-3 pb-4 border-b" style={{ borderColor: org?.accent_color || '#64748b' }}>
      {org?.logo_url ? (
        <img src={org.logo_url} alt="" className="h-10 w-auto object-contain" />
      ) : (
        <div className="h-10 w-10 rounded-full" style={{ backgroundColor: org?.accent_color || '#64748b' }} />
      )}
      <div>
        <p className="text-sm text-secondary-500">Prise de rendez-vous</p>
        <h1 className="text-lg font-semibold text-secondary-900">{org?.name || 'Votre entreprise'}</h1>
      </div>
    </header>
  );
}

function Pied({ org }) {
  if (!org?.phone) return null;
  return (
    <footer className="mt-8 pt-4 border-t border-secondary-200 text-sm text-secondary-500">
      Une question ? Appelez-nous au{' '}
      <a href={`tel:${org.phone.replace(/\s/g, '')}`} className="font-medium text-secondary-800 underline">{org.phone}</a>.
    </footer>
  );
}

export default function PriseRdv() {
  const { token } = useParams();
  const [etat, setEtat] = useState('chargement'); // chargement · erreur · deja · choix · confirmation · pose · succes
  const [offre, setOffre] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [choisi, setChoisi] = useState(null);
  const [resultat, setResultat] = useState(null);
  const [avis, setAvis] = useState(null); // message contextuel (conflit, rechargement)

  const charger = useCallback(async () => {
    setEtat('chargement');
    setErreur(null);
    const { ok, json } = await appelerEdge({ token });
    if (!ok) {
      setErreur(json?.error || 'indisponible');
      setOffre(json && json.org ? json : null);
      setEtat('erreur');
      return;
    }
    setOffre(json);
    setEtat(json.deja ? 'deja' : 'choix');
  }, [token]);

  useEffect(() => { charger(); }, [charger]);

  const parDate = useMemo(() => {
    const map = new Map();
    for (const c of offre?.creneaux || []) {
      if (!map.has(c.date)) map.set(c.date, []);
      map.get(c.date).push(c);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [offre]);

  const confirmer = async () => {
    if (!choisi) return;
    setEtat('pose');
    const { ok, status, json } = await appelerEdge({
      method: 'POST', token,
      body: { action: 'book', token, creneau: { date: choisi.date, technicien_id: choisi.technicien_id, demi: choisi.demi, empreinte: choisi.empreinte } },
    });
    if (ok) {
      setResultat(json);
      setEtat('succes');
      return;
    }
    if (status === 409) {
      setAvis(json?.error === 'deja_planifie'
        ? 'Un rendez-vous est déjà prévu pour vous.'
        : 'Cette demi-journée vient de se remplir. Voici les créneaux encore disponibles.');
      setChoisi(null);
      await charger();
      return;
    }
    setErreur(json?.error || 'indisponible');
    setEtat('erreur');
  };

  const org = offre?.org;

  return (
    <div className="min-h-screen bg-secondary-50 text-secondary-900">
      <main className="max-w-md mx-auto p-4 sm:p-6">
        <Entete org={org} />

        {etat === 'chargement' && (
          <p className="mt-8 text-center text-secondary-500">Nous regardons les disponibilités…</p>
        )}

        {etat === 'erreur' && (
          <section className="mt-8 space-y-3">
            <p className="text-base font-medium">{MESSAGES_ERREUR[erreur] || 'La prise de rendez-vous en ligne est momentanément indisponible.'}</p>
            <p className="text-sm text-secondary-600">Contactez-nous par téléphone pour convenir d’un rendez-vous.</p>
          </section>
        )}

        {etat === 'deja' && offre?.deja && (
          <section className="mt-8 space-y-3">
            <p className="text-base">Bonjour{offre.client?.prenom ? ` ${offre.client.prenom}` : ''},</p>
            <p className="text-base font-medium">
              Votre entretien est déjà prévu le {formatDateLongue(offre.deja.date)}, {LIBELLE_DEMI[offre.deja.demi]?.toLowerCase()}
              {offre.deja.technicien ? ` avec ${offre.deja.technicien}` : ''}.
            </p>
            <p className="text-sm text-secondary-600">L’heure exacte de passage vous sera confirmée par SMS. Pour le déplacer, appelez-nous.</p>
          </section>
        )}

        {(etat === 'choix' || etat === 'confirmation' || etat === 'pose') && offre && (
          <section className="mt-6 space-y-4">
            <p className="text-base">Bonjour{offre.client?.prenom ? ` ${offre.client.prenom}` : ''},</p>
            <p className="text-base">
              C’est le moment de l’entretien annuel
              {offre.contrat?.categories?.length ? ` de votre ${offre.contrat.categories.join(', ').toLowerCase()}` : ''}.
              Choisissez la demi-journée qui vous convient : nous vous confirmerons l’heure exacte par SMS.
            </p>
            {avis && <p className="text-sm rounded-md bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">{avis}</p>}

            {parDate.length === 0 ? (
              <div className="rounded-md bg-white border border-secondary-200 p-4 space-y-2">
                <p className="font-medium">Aucune demi-journée n’est disponible en ligne ce mois-ci.</p>
                <p className="text-sm text-secondary-600">Appelez-nous, nous trouverons une date ensemble.</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {parDate.map(([date, creneaux]) => (
                  <li key={date} className="rounded-md bg-white border border-secondary-200 p-3">
                    <p className="font-medium capitalize">{formatDateLongue(date)}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {creneaux.map((c) => {
                        const actif = choisi?.id === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { setChoisi(c); setEtat('confirmation'); }}
                            disabled={etat === 'pose'}
                            className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${actif ? 'border-secondary-900 bg-secondary-900 text-white' : 'border-secondary-300 hover:border-secondary-500'}`}
                          >
                            <span className="block font-medium">{LIBELLE_DEMI[c.demi]}</span>
                            <span className={`block text-xs ${actif ? 'text-white/80' : 'text-secondary-500'}`}>{PLAGE_DEMI[c.demi]} · avec {c.technicien}</span>
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {choisi && (
              <div className="sticky bottom-4 rounded-md bg-white border border-secondary-300 shadow-lg p-4 space-y-3">
                <p className="text-sm">
                  Confirmer le <span className="font-medium">{formatDateLongue(choisi.date)}, {LIBELLE_DEMI[choisi.demi].toLowerCase()}</span> avec {choisi.technicien} ?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={confirmer}
                    disabled={etat === 'pose'}
                    className="flex-1 rounded-md px-4 py-2 text-white font-medium disabled:opacity-60"
                    style={{ backgroundColor: org?.accent_color || '#0f172a' }}
                  >
                    {etat === 'pose' ? 'Enregistrement…' : 'Je confirme'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setChoisi(null); setEtat('choix'); }}
                    disabled={etat === 'pose'}
                    className="rounded-md border border-secondary-300 px-4 py-2 text-sm"
                  >
                    Changer
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {etat === 'succes' && resultat && (
          <section className="mt-8 space-y-3">
            <p className="text-lg font-semibold">C’est noté, merci !</p>
            <p className="text-base">
              Votre entretien aura lieu le <span className="font-medium">{formatDateLongue(resultat.date)}, {LIBELLE_DEMI[resultat.demi].toLowerCase()}</span>
              {resultat.technicien ? ` avec ${resultat.technicien}` : ''}.
            </p>
            <p className="text-sm text-secondary-600">L’heure exacte de passage vous sera envoyée par SMS quelques jours avant. Vous pouvez fermer cette page.</p>
          </section>
        )}

        <Pied org={org} />
      </main>
    </div>
  );
}
