// src/lib/smsCampaigns.js
// ============================================================================
// Campagnes SMS / WhatsApp — registre + helpers PURS (aucun import React/Supabase).
//
// Source unique de « quelles campagnes le code envoie, avec quelles variables ».
// Consommé par :
//   - Settings → Organisation → SMS (`SmsTab`) : liste des gabarits à éditer,
//     variables disponibles, texte suggéré, réglage du rappel automatique ;
//   - les émetteurs : le front (`savService`) et l'edge `sms-rappel-rdv` via la
//     COPIE Deno `supabase/functions/_shared/smsCampaigns.js` générée par
//     `npm run sync:tournee-engine` (ne jamais éditer la copie ; le test
//     `scripts/tournee/sync-engine.test.mjs` échoue si elle diverge).
// Les gabarits eux-mêmes vivent dans `core.organizations.settings.sms.templates`
// (édités par l'org) et sont rendus par `_shared/sms.ts` ({{variable}} → valeur).
//
// ⚠ Ajouter une campagne = une entrée ici + le gabarit saisi dans l'onglet SMS.
// Sans gabarit, l'envoi répond `campaign_template_missing` : l'appelant doit le
// traiter comme une information (toast / compteur), jamais comme une erreur bloquante.
// ⚠ Ce fichier doit rester exécutable sous Deno : pas d'import, pas d'alias Vite.
//
// Testé : node --test scripts/sms-campaigns.test.mjs
// ============================================================================

export const SMS_CAMPAIGNS = [
  {
    key: 'avis_j1',
    label: 'Demande d’avis après entretien',
    trigger: 'Bouton « Avis » d’une carte SAV / entretien réalisée (onglet Entretiens).',
    variables: [
      { name: 'first_name', label: 'Prénom du client' },
      { name: 'short_link', label: 'Lien court vers la page d’avis (généré à l’envoi)' },
    ],
    suggested: {
      whatsapp:
        'Bonjour {{first_name}},\n\nMerci de nous avoir fait confiance pour votre entretien ! '
        + 'Votre avis aide d’autres clients à nous choisir :\n{{short_link}}\n\nMerci et à bientôt !',
      sms:
        'Bonjour {{first_name}}, merci de nous avoir fait confiance pour votre entretien ! '
        + 'Un avis pour aider d\'autres clients : {{short_link}} Merci !',
      deburr: true,
    },
  },
  {
    key: 'rappel_entretien',
    label: 'Rappel d’entretien annuel',
    trigger: 'Bulle SMS d’une ligne « à planifier » de l’onglet Programmation.',
    variables: [
      { name: 'first_name', label: 'Prénom du client' },
      { name: 'name', label: 'Nom du client' },
      { name: 'full_name', label: 'Prénom + nom (en majuscules)' },
    ],
    suggested: {
      sms:
        'Bonjour {{full_name}}, votre entretien annuel approche : vous recevrez un appel dans les '
        + 'prochains jours pour fixer votre rendez-vous. Vous pouvez aussi nous appeler pour convenir '
        + 'du meilleur moment.',
      deburr: true,
    },
  },
  {
    key: 'rappel_rdv',
    label: 'Rappel des rendez-vous d’entretien',
    trigger: 'Automatique (cron, réglage « Rappel des rendez-vous » ci-dessus) : un SMS par rendez-vous d’entretien planifié, la veille ou en début de semaine.',
    variables: [
      { name: 'prenom', label: 'Prénom du client' },
      { name: 'date', label: 'Date du rendez-vous (ex. « mardi 13 octobre »)' },
      { name: 'heure', label: 'Heure d’arrivée prévue (ex. « 9h30 »)' },
      { name: 'technicien', label: 'Prénom du technicien' },
    ],
    suggested: {
      whatsapp:
        'Bonjour {{prenom}},\n\nRappel : votre entretien est prévu le {{date}} à {{heure}}. '
        + '{{technicien}} sera votre technicien.\n\nEn cas d’empêchement, merci de nous prévenir. À bientôt !',
      sms:
        'Bonjour {{prenom}}, rappel : votre entretien est prévu le {{date}} à {{heure}} '
        + 'avec {{technicien}}. En cas d\'empêchement, merci de nous prévenir. À bientôt !',
      deburr: true,
    },
  },
];

export function getSmsCampaign(key) {
  return SMS_CAMPAIGNS.find((c) => c.key === key) || null;
}

/**
 * « mardi 13 octobre » depuis une date `YYYY-MM-DD` (construite en heure locale :
 * `new Date('YYYY-MM-DD')` est minuit UTC et peut glisser d'un jour). Sans année :
 * une confirmation de RDV parle de la prochaine occurrence. « 1er » plutôt que « 1 ».
 */
export function formatSmsDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate ?? ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return '';
  const label = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  return label.replace(/\b1 (?=\p{L})/u, '1er ');
}

/** « 9h30 » / « 14h » depuis `HH:MM` ou `HH:MM:SS` (format Postgres `time`). */
export function formatSmsHour(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? '').trim());
  if (!m) return '';
  const h = Number(m[1]);
  const mn = m[2];
  if (h > 23 || Number(mn) > 59) return '';
  return mn === '00' ? `${h}h` : `${h}h${mn}`;
}

/**
 * Variables du gabarit `rappel_rdv`. Toujours 4 clés, toujours des chaînes
 * (l'edge remplace une clé absente par du vide puis recolle la ponctuation).
 */
export function buildRappelRdvVars({ clientFirstName, date, startTime, technicianName } = {}) {
  return {
    prenom: String(clientFirstName ?? '').trim(),
    date: formatSmsDate(date),
    heure: formatSmsHour(startTime),
    technicien: String(technicianName ?? '').trim(),
  };
}

/** Nom du technicien tel que le client le lit dans un SMS : prénom, repli nom complet. */
export function smsNameForMember(member) {
  return String(member?.first_name || member?.display_name || '').trim();
}

// ---------------------------------------------------------------------------
// Rappel des rendez-vous — réglage d'org `settings.sms.rappel_rdv` et planification
// ---------------------------------------------------------------------------
// Le cron tourne toutes les heures ; c'est CE réglage (éditable dans l'onglet SMS)
// qui décide quand une org envoie, et pour quelle fenêtre de rendez-vous :
//   - `veille` : chaque jour à `heure`, les rendez-vous du lendemain ;
//   - `hebdo`  : le `jour` choisi à `heure`, les rendez-vous des 7 jours suivants ;
//   - `off`    : rien (défaut — l'activation est un geste explicite de l'admin).
// L'heure H accepte aussi H+1 : la 2ᵉ passe retente ce qui a échoué (un envoi
// réussi marque `appointments.client_notified_at`, donc jamais de doublon).

export const RAPPEL_RDV_MODES = ['off', 'veille', 'hebdo'];
export const RAPPEL_RDV_DEFAUTS = Object.freeze({ mode: 'off', jour: 1, heure: 8 });
export const RAPPEL_RDV_HEURE_MIN = 7;
export const RAPPEL_RDV_HEURE_MAX = 20;
/** ISO 8601 : 1 = lundi … 7 = dimanche. */
export const JOURS_SEMAINE = [
  { value: 1, label: 'lundi' },
  { value: 2, label: 'mardi' },
  { value: 3, label: 'mercredi' },
  { value: 4, label: 'jeudi' },
  { value: 5, label: 'vendredi' },
  { value: 6, label: 'samedi' },
  { value: 7, label: 'dimanche' },
];

/** Réglage effectif depuis `settings.sms` : défauts + valeurs hors bornes ramenées aux défauts. */
export function buildRappelRdvConfig(sms) {
  const raw = sms?.rappel_rdv || {};
  const mode = RAPPEL_RDV_MODES.includes(raw.mode) ? raw.mode : RAPPEL_RDV_DEFAUTS.mode;
  const jour = Number.isInteger(raw.jour) && raw.jour >= 1 && raw.jour <= 7 ? raw.jour : RAPPEL_RDV_DEFAUTS.jour;
  const heure = Number.isInteger(raw.heure) && raw.heure >= RAPPEL_RDV_HEURE_MIN && raw.heure <= RAPPEL_RDV_HEURE_MAX
    ? raw.heure
    : RAPPEL_RDV_DEFAUTS.heure;
  return { mode, jour, heure };
}

const DAY_MS = 86_400_000;
const isoToUtcMs = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};
const utcMsToIso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Jour de semaine ISO (1 = lundi … 7 = dimanche) d'une date `YYYY-MM-DD`, sans fuseau. */
export function jourSemaineIso(iso) {
  const ms = isoToUtcMs(iso);
  if (Number.isNaN(ms)) return null;
  const dow = new Date(ms).getUTCDay(); // 0 = dimanche
  return dow === 0 ? 7 : dow;
}

/** `YYYY-MM-DD` + n jours, en arithmétique UTC (aucun glissement aux changements d'heure). */
export function ajouterJours(iso, n) {
  const ms = isoToUtcMs(iso);
  if (Number.isNaN(ms)) return '';
  return utcMsToIso(ms + n * DAY_MS);
}

/**
 * Fenêtre de rendez-vous à rappeler MAINTENANT, ou null s'il n'y a rien à faire.
 * @param {{mode,jour,heure}} config    réglage effectif (cf. buildRappelRdvConfig)
 * @param {{date:string, heure:number}} maintenant  date `YYYY-MM-DD` et heure LOCALES (Europe/Paris)
 */
export function planifierRappelRdv(config, maintenant) {
  if (!config || !maintenant) return null;
  const { mode, jour, heure } = config;
  if (mode !== 'veille' && mode !== 'hebdo') return null;
  if (!(maintenant.heure === heure || maintenant.heure === heure + 1)) return null;
  if (mode === 'veille') {
    const demain = ajouterJours(maintenant.date, 1);
    return demain ? { debut: demain, fin: demain } : null;
  }
  if (jourSemaineIso(maintenant.date) !== jour) return null;
  return { debut: maintenant.date, fin: ajouterJours(maintenant.date, 6) };
}

/** Phrase de l'onglet Settings décrivant le réglage. */
export function decrireRappelRdv(config) {
  const { mode, jour, heure } = buildRappelRdvConfig({ rappel_rdv: config });
  if (mode === 'veille') return `Chaque jour à ${heure}h, pour les rendez-vous du lendemain.`;
  if (mode === 'hebdo') {
    const label = JOURS_SEMAINE.find((j) => j.value === jour)?.label || 'lundi';
    return `Chaque ${label} à ${heure}h, pour les rendez-vous des 7 jours suivants.`;
  }
  return 'Désactivé : aucun rappel automatique.';
}

/**
 * Nettoyage avant enregistrement des gabarits : textes trimés, textes vides retirés,
 * campagne sans aucun texte retirée (l'edge dira `campaign_template_missing`),
 * `deburr` conservé seulement s'il est vrai.
 */
export function normalizeSmsTemplates(templates) {
  const out = {};
  for (const [key, tpl] of Object.entries(templates || {})) {
    const whatsapp = String(tpl?.whatsapp ?? '').trim();
    const sms = String(tpl?.sms ?? '').trim();
    if (!whatsapp && !sms) continue;
    const clean = {};
    if (whatsapp) clean.whatsapp = whatsapp;
    if (sms) clean.sms = sms;
    if (tpl?.deburr === true) clean.deburr = true;
    out[key] = clean;
  }
  return out;
}

/**
 * Lignes de l'éditeur : le registre dans l'ordre, puis les clés présentes en base
 * mais inconnues du code (`unknown: true`) — affichées et préservées, jamais
 * supprimées en silence.
 */
export function listSmsCampaignsForEditor(templates) {
  const known = SMS_CAMPAIGNS.map((c) => ({ ...c, unknown: false }));
  const extra = Object.keys(templates || {})
    .filter((key) => !SMS_CAMPAIGNS.some((c) => c.key === key))
    .sort()
    .map((key) => ({
      key,
      label: key,
      trigger: 'Campagne inconnue du code : aucun envoi ne l’utilise. Conservée telle quelle.',
      variables: [],
      suggested: null,
      unknown: true,
    }));
  return [...known, ...extra];
}

// Injectées par l'edge pour toute campagne (lien court généré à l'envoi).
const EDGE_PROVIDED_VARIABLES = ['short_link', 'short_code'];

/**
 * Jetons `{{…}}` d'un gabarit qui ne correspondent à aucune variable de la campagne.
 * Volontairement plus large que la regex de l'edge (`[a-z0-9_]+`) : `{{prénom}}` ou
 * `{{ Prenom }}` ne seraient PAS substitués et partiraient tels quels chez le client —
 * c'est précisément ce qu'on veut attraper à la saisie. Campagne inconnue du code :
 * rien à valider.
 */
export function findUnknownVariables(text, campaign) {
  if (!campaign || campaign.unknown) return [];
  const allowed = new Set([...campaign.variables.map((v) => v.name), ...EDGE_PROVIDED_VARIABLES]);
  const unknown = [];
  for (const m of String(text ?? '').matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    const name = m[1];
    if (!allowed.has(name) && !unknown.includes(name)) unknown.push(name);
  }
  return unknown;
}

/**
 * Retire les diacritiques : « éàç » → « eac ».
 * ⚠ Même expression que `deburr()` de `supabase/functions/_shared/sms.ts` : sert au
 * compteur de segments quand l'option « sans accents » est cochée. Toute évolution
 * doit toucher LES DEUX. `\p{M}` (marques combinantes) plutôt qu'une plage
 * `\uXXXX` : même résultat sur du NFD, sans échappement fragile à recopier.
 */
export function deburrSms(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '');
}

// Alphabet GSM 03.38 (jeu de base) + caractères d'extension (comptent double).
// Un seul caractère hors alphabet bascule tout le message en UCS-2 : 70 caractères
// par segment au lieu de 160 (67 / 153 en concaténé). Les accents courants du
// français ne s'y trouvent pas tous : « é è à ù ç » passent, « ê â î ô û ë ï œ » non,
// pas plus que l'apostrophe typographique « ’ » ni les guillemets « ».
const GSM7_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
  + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '\f^{}\\[~]|€';

/** Estimation de l'encodage et du nombre de segments d'un SMS (texte déjà rendu ou gabarit). */
export function estimateSmsSegments(text) {
  const s = String(text ?? '');
  if (!s) return { chars: 0, segments: 0, encoding: 'gsm7' };

  let units = 0;
  let gsm = true;
  for (const ch of s) {
    if (GSM7_BASIC.includes(ch)) units += 1;
    else if (GSM7_EXT.includes(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (gsm) {
    return { chars: units, segments: units <= 160 ? 1 : Math.ceil(units / 153), encoding: 'gsm7' };
  }
  // UCS-2 : une unité UTF-16 par caractère (les émojis en comptent deux, comme chez l'opérateur).
  const len = s.length;
  return { chars: len, segments: len <= 70 ? 1 : Math.ceil(len / 67), encoding: 'ucs2' };
}
