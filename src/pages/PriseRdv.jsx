/**
 * PriseRdv.jsx — page publique de prise de rendez-vous d'entretien (/rdv/:token)
 * ============================================================================
 * Spec 2026-09-29 « auto-RDV d'entretien mensuel » § 4.2. Sans compte, sans
 * session : la page ne parle qu'à l'edge `auto-rdv` avec le jeton de l'URL.
 * Les demi-journées sont calculées à l'ouverture sur le planning du moment,
 * jamais figées dans un mail ; la pose est atomique côté serveur et, si la
 * demi-journée s'est remplie entre-temps, la page recharge les créneaux.
 * Le client ne voit que : sa date, matin / après-midi, le prénom du technicien.
 * Habillage commun aux pages sans compte : src/pages/public/pageUi.jsx.
 * ============================================================================
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarCheck, CalendarDays, CalendarX2, Check, Clock, UserRound } from 'lucide-react';
import { prenomLisible } from '@/lib/pagePublique';
import {
  PageAlerte, PageAttente, PageBouton, PageCoche, PageCoque, PageFiche, PageMessage, PageTitre,
} from './public/pageUi';

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

/** « mardi 24 novembre » → « Mardi 24 novembre ». */
function majuscule(texte) {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/** Les lignes de la fiche d'un rendez-vous : date, demi-journée, technicien. */
function lignesRdv({ date, demi, technicien }) {
  return [
    { icone: CalendarDays, libelle: 'Date', valeur: majuscule(formatDateLongue(date)) },
    { icone: Clock, libelle: 'Demi-journée', valeur: [LIBELLE_DEMI[demi], PLAGE_DEMI[demi] && `(${PLAGE_DEMI[demi]})`].filter(Boolean).join(' ') },
    { icone: UserRound, libelle: 'Technicien', valeur: technicien },
  ];
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

function Creneau({ creneau, actif, disabled, onChoisir }) {
  return (
    <button
      type="button" onClick={onChoisir} disabled={disabled} aria-pressed={actif}
      className={`flex min-h-[72px] items-start gap-2 rounded-2xl border-2 p-4 text-left transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-900 focus-visible:ring-offset-2 ${
        actif ? 'border-[color:var(--marque)] bg-[color:var(--marque-doux)]' : 'border-secondary-200 bg-white hover:border-secondary-300'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold">{LIBELLE_DEMI[creneau.demi]}</span>
        <span className="block text-sm text-secondary-700">{PLAGE_DEMI[creneau.demi]}</span>
        {creneau.technicien && <span className="block text-sm text-secondary-700">avec {creneau.technicien}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
          actif ? 'border-[color:var(--marque)] bg-[color:var(--marque)] text-[color:var(--marque-texte)]' : 'border-secondary-300 bg-white'
        }`}
      >
        {actif && <Check className="h-4 w-4" strokeWidth={3} />}
      </span>
    </button>
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
  const prenom = prenomLisible(offre?.client?.prenom);
  const categories = offre?.contrat?.categories?.length ? ` de votre ${offre.contrat.categories.join(', ').toLowerCase()}` : '';
  const enChoix = (etat === 'choix' || etat === 'confirmation' || etat === 'pose') && !!offre;

  return (
    <PageCoque
      nom={org?.name || 'Votre entreprise'} logo={org?.logo_url} couleur={org?.accent_color} telephone={org?.phone}
      attente={etat === 'chargement' && !offre}
    >
      {etat === 'chargement' && (
        <PageAttente libelle="Recherche des disponibilités">Nous regardons les disponibilités…</PageAttente>
      )}

      {etat === 'erreur' && (
        <PageMessage
          icone={CalendarX2}
          titre={MESSAGES_ERREUR[erreur] || 'La prise de rendez-vous en ligne est momentanément indisponible.'}
        >
          Contactez-nous par téléphone pour convenir d’un rendez-vous.
        </PageMessage>
      )}

      {etat === 'deja' && offre?.deja && (
        <div className="space-y-6">
          <div className="space-y-4">
            <PageCoche />
            <PageTitre titre="Votre entretien est déjà prévu">
              {prenom ? `Bonjour ${prenom}, voici` : 'Voici'} le rendez-vous enregistré.
            </PageTitre>
          </div>
          <PageFiche lignes={lignesRdv(offre.deja)} />
          <p className="text-base leading-relaxed text-secondary-700">
            L’heure exacte de passage vous sera confirmée par SMS. Pour le déplacer, appelez-nous.
          </p>
        </div>
      )}

      {enChoix && parDate.length === 0 && (
        <div className="space-y-4">
          {avis && <PageAlerte>{avis}</PageAlerte>}
          <PageMessage icone={CalendarX2} titre="Aucune demi-journée n’est disponible en ligne ce mois-ci.">
            {prenom ? `Bonjour ${prenom}, appelez-nous` : 'Appelez-nous'}, nous trouverons une date ensemble.
          </PageMessage>
        </div>
      )}

      {enChoix && parDate.length > 0 && (
        <div className="space-y-8">
          <PageTitre surtitre="Entretien annuel" titre="Choisissez votre demi-journée">
            {prenom ? `Bonjour ${prenom}, c’est` : 'C’est'} le moment de l’entretien annuel{categories}. Choisissez la
            demi-journée qui vous convient : nous vous confirmerons l’heure exacte par SMS.
          </PageTitre>
          {avis && <PageAlerte>{avis}</PageAlerte>}

          <ul className="space-y-6">
            {parDate.map(([date, creneaux]) => (
              <li key={date}>
                <h2 className="mb-3 text-base font-semibold">{majuscule(formatDateLongue(date))}</h2>
                <div className="grid grid-cols-2 gap-3">
                  {creneaux.map((c) => (
                    <Creneau
                      key={c.id} creneau={c} actif={choisi?.id === c.id} disabled={etat === 'pose'}
                      onChoisir={() => { setChoisi(c); setEtat('confirmation'); }}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>

          {choisi && (
            <div className="sticky bottom-4 space-y-3 rounded-2xl border border-secondary-200 bg-white p-4 shadow-lg">
              <p className="text-base">
                <span className="font-semibold">{majuscule(formatDateLongue(choisi.date))}, {LIBELLE_DEMI[choisi.demi].toLowerCase()}</span>
                {choisi.technicien ? `, avec ${choisi.technicien}` : ''}
              </p>
              <PageBouton onClick={confirmer} attente={etat === 'pose'} icone={CalendarCheck}>Je confirme ce rendez-vous</PageBouton>
              <button
                type="button" disabled={etat === 'pose'}
                onClick={() => { setChoisi(null); setEtat('choix'); }}
                className="min-h-[44px] w-full rounded-xl text-sm font-medium text-secondary-800 hover:bg-secondary-100 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-900"
              >
                Choisir une autre demi-journée
              </button>
            </div>
          )}
        </div>
      )}

      {etat === 'succes' && resultat && (
        <div className="space-y-6">
          <div className="space-y-4">
            <PageCoche />
            <PageTitre titre="C’est noté, merci !">Votre entretien est enregistré.</PageTitre>
          </div>
          <PageFiche lignes={lignesRdv(resultat)} />
          <p className="text-base leading-relaxed text-secondary-700">
            L’heure exacte de passage vous sera envoyée par SMS quelques jours avant. Vous pouvez fermer cette page.
          </p>
        </div>
      )}
    </PageCoque>
  );
}
