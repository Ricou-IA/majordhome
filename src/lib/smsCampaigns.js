// src/lib/smsCampaigns.js
// ============================================================================
// Campagnes SMS / WhatsApp — registre + helpers PURS (aucun import React/Supabase).
//
// Source unique de « quelles campagnes le code envoie, avec quelles variables ».
// Consommé par :
//   - Settings → Organisation → SMS (`SmsTab`) : liste des gabarits à éditer,
//     variables disponibles, texte suggéré ;
//   - les émetteurs (`savService.sendRdvConfirmation`, …) : construction des `vars`.
// Les gabarits eux-mêmes vivent dans `core.organizations.settings.sms.templates`
// (édités par l'org) et sont rendus par l'edge `sms-send` ({{variable}} → valeur).
//
// ⚠ Ajouter une campagne = une entrée ici + le gabarit saisi dans l'onglet SMS.
// Sans gabarit, l'edge répond `campaign_template_missing` : l'appelant doit le
// traiter comme une information (toast), jamais comme une erreur bloquante.
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
    key: 'confirmation_rdv',
    label: 'Confirmation de rendez-vous',
    trigger: 'Rendez-vous d’entretien posé depuis la fiche contrat (créneau optimisé ou planification manuelle).',
    variables: [
      { name: 'prenom', label: 'Prénom du client' },
      { name: 'date', label: 'Date du rendez-vous (ex. « mardi 13 octobre »)' },
      { name: 'heure', label: 'Heure d’arrivée prévue (ex. « 9h30 »)' },
      { name: 'technicien', label: 'Prénom du technicien' },
    ],
    suggested: {
      whatsapp:
        'Bonjour {{prenom}},\n\nVotre rendez-vous d’entretien est confirmé le {{date}} à {{heure}}. '
        + '{{technicien}} sera votre technicien.\n\nEn cas d’empêchement, merci de nous prévenir. À bientôt !',
      sms:
        'Bonjour {{prenom}}, votre rendez-vous d\'entretien est confirmé le {{date}} à {{heure}} '
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
 * Variables du gabarit `confirmation_rdv`. Toujours 4 clés, toujours des chaînes
 * (l'edge remplace une clé absente par du vide puis recolle la ponctuation).
 */
export function buildConfirmationRdvVars({ clientFirstName, date, startTime, technicianName } = {}) {
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
 * ⚠ COPIE de `deburr()` de l'edge `sms-send` (Deno ne partage pas ce code) : sert au
 * compteur de segments quand l'option « sans accents » est cochée. Toute évolution
 * doit toucher LES DEUX.
 */
export function deburrSms(text) {
  return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
