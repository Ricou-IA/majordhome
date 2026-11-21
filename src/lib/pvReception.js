// src/lib/pvReception.js
// ============================================================================
// PV de réception signé en ligne — règles PURES partagées par l'écran (fiche chantier,
// page publique /pv/:token) et l'edge `chantier-pv` (copie Deno générée par
// `npm run sync:tournee-engine`, ne jamais éditer la copie).
// Spec : docs/superpowers/specs/2026-11-17-chantier-apres-vente-pv-en-ligne-design.md
//
// ⚠ Ce fichier doit rester exécutable sous Deno : pas d'import, pas d'alias Vite.
// Testé : node --test scripts/pv-reception.test.mjs
// ============================================================================

/** Gabarit transactionnel de l'e-mail qui porte le lien (créé depuis Paramètres → E-mails & SMS). */
export const PV_RECEPTION_TEMPLATE_KEY = 'pv_reception';

export const DEFAULT_PV_RECEPTION_EMAIL = Object.freeze({
  key: PV_RECEPTION_TEMPLATE_KEY,
  label: 'PV de réception à signer en ligne',
  subject: 'Votre installation est terminée : merci de signer la réception des travaux',
  html_body: [
    '<p>Bonjour {{PRENOM}},</p>',
    '<p>Votre installation est terminée ({{OBJET}}). Pour clore le chantier, merci de signer le procès-verbal de réception des travaux :',
    ' cela prend une minute, depuis votre téléphone.</p>',
    '<p style="text-align:center;margin:28px 0">',
    '<a href="{{LIEN_PV}}" style="background:{{ACCENT_COLOR}};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Signer la réception des travaux</a>',
    '</p>',
    '<p>Si quelque chose ne vous convient pas, vous pourrez l’indiquer avant de signer : nous reviendrons vers vous.',
    ' Une question ? Répondez à cet e-mail.</p>',
    '<p>Merci de votre confiance,<br>{{BRAND_NAME}}</p>',
  ].join(''),
  is_transactional: true,
});

/** Gabarit transactionnel de l'e-mail qui demande de signer la levée des réserves. */
export const PV_LEVEE_TEMPLATE_KEY = 'pv_levee_reserves';

export const DEFAULT_PV_LEVEE_EMAIL = Object.freeze({
  key: PV_LEVEE_TEMPLATE_KEY,
  label: 'Levée des réserves à signer en ligne',
  subject: 'Les points signalés sont réglés : merci de confirmer la levée des réserves',
  html_body: [
    '<p>Bonjour {{PRENOM}},</p>',
    '<p>Lors de la réception de votre installation ({{OBJET}}), vous nous avez signalé des points à reprendre.',
    ' Nous nous en sommes occupés. Merci de nous confirmer, en signant, que ces réserves sont levées :',
    ' cela prend une minute, depuis votre téléphone.</p>',
    '<p style="text-align:center;margin:28px 0">',
    '<a href="{{LIEN_PV}}" style="background:{{ACCENT_COLOR}};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Confirmer la levée des réserves</a>',
    '</p>',
    '<p>Si quelque chose n’est pas réglé, ne signez pas : répondez à cet e-mail et nous reviendrons chez vous.</p>',
    '<p>Merci de votre confiance,<br>{{BRAND_NAME}}</p>',
  ].join(''),
  is_transactional: true,
});

/** Durée de validité du lien envoyé au client. */
export const PV_LIEN_VALIDITE_JOURS = 60;

export const PV_NOM_MAX = 120;
export const PV_TEXTE_MAX = 2000;
/** Longueur maximale de l'image de la signature (data URL PNG), même borne que la RPC. */
export const PV_SIGNATURE_MAX = 400000;
const PV_SIGNATURE_MIN = 200;
const PREFIXE_PNG = 'data:image/png;base64,';

export const PV_RECEPTION_TYPES = Object.freeze(['sans_reserves', 'avec_reserves']);

/**
 * Codes rendus par l'edge `chantier-pv` (et par la RPC `chantier_pv_signer`) → message à l'écran.
 * Un code ajouté d'un côté s'ajoute ici (le test le vérifie pour ceux de la validation).
 */
const MESSAGES = Object.freeze({
  // validation de la réponse du client
  choix_requis: 'Indiquez si vous acceptez la réception avec ou sans réserve.',
  nom_requis: 'Écrivez votre nom et votre prénom.',
  signature_requise: 'Signez dans le cadre, puis appuyez sur « Valider la signature ».',
  reserves_a_decrire: 'Décrivez les réserves que vous souhaitez signaler.',
  texte_trop_long: 'Le texte est trop long (2 000 caractères au plus).',
  // PV complété et levée des réserves
  // Lu par le bureau ET par le client (signature d'un PV dont la préparation a disparu).
  pv_non_prepare: 'Ce procès-verbal n’est pas encore prêt à être signé.',
  declaration_incomplete: 'La déclaration de l’entreprise est incomplète : répondez à chaque point avant d’envoyer le lien.',
  point_inconnu: 'Ce procès-verbal vient d’être mis à jour : relisez-le avant de signer.',
  gabarit_different: 'Les points de ce procès-verbal ont changé : complétez les nouveaux points avant d’envoyer.',
  gabarit_inconnu: 'Ce gabarit de points n’existe pas : choisissez-en un autre.',
  pas_de_reserves: 'Ce procès-verbal a été signé sans réserve : il n’y a rien à lever.',
  levee_non_demandee: 'La levée des réserves ne vous a pas encore été demandée. Contactez votre installateur.',
  levee_deja_signee: 'Les réserves de ce procès-verbal ont déjà été levées.',
  echeance_invalide: 'La date prévue n’est pas valable : elle doit être un vrai jour, au plus tôt celui de la signature du procès-verbal.',
  reponse_vide: 'Indiquez ce qui a été fait ou la date prévue pour les réserves.',
  pv_modifie: 'Votre installateur vient de mettre à jour ce procès-verbal : relisez-le avant de signer.',
  // état du chantier ou du lien
  deja_signe: 'Ce procès-verbal a déjà été signé.',
  chantier_introuvable: 'Ce chantier est introuvable.',
  invalid_token: 'Ce lien n’est pas valable.',
  signature_mismatch: 'Ce lien n’est pas valable.',
  token_expired: 'Ce lien a expiré. Demandez-en un nouveau à votre installateur.',
  too_many_requests: 'Trop de tentatives. Réessayez dans une heure.',
  // envoi par le bureau
  client_sans_email: 'Le client n’a pas d’adresse e-mail : copiez le lien pour l’envoyer autrement.',
  template_missing: 'Le texte de l’e-mail n’est pas encore créé (Paramètres → E-mails & SMS).',
  expediteur_absent: 'L’adresse d’expédition des e-mails n’est pas renseignée (Paramètres → E-mails & SMS).',
  module_communication_ferme: 'L’envoi d’e-mails n’est pas ouvert pour votre entreprise : copiez le lien pour l’envoyer autrement.',
  droit_requis: 'Vous n’avez pas le droit de modifier les chantiers.',
  envoi_echoue: 'L’e-mail n’a pas pu partir.',
  envoi_non_note: 'L’e-mail est parti, mais son envoi n’a pas pu être noté sur le chantier.',
  secret_non_configure: 'Le lien de signature n’est pas configuré sur le serveur.',
  resend_non_configure: 'L’envoi d’e-mails n’est pas configuré sur le serveur.',
  action_inconnue: 'Cette action n’est pas encore disponible sur le serveur : réessayez dans quelques minutes ou prévenez votre administrateur.',
});

/**
 * @param {string|null|undefined} code
 * @param {string} [defaut]
 * @returns {string}
 */
export function messagePv(code, defaut = 'Une erreur est survenue. Réessayez dans un instant.') {
  return MESSAGES[code] || defaut;
}

/** Les codes connus (pour les tests). */
export const PV_CODES = Object.freeze(Object.keys(MESSAGES));

/**
 * Valide la réponse du client AVANT de l'envoyer (page publique) et avant d'appeler la RPC
 * (edge). Mêmes règles que `public.chantier_pv_signer` : ce qui passe ici passe en base.
 * @param {Object|null|undefined} reponse
 * @returns {string|null} code du refus, ou `null` si la réponse est complète
 */
export function validerReponsePv(reponse) {
  const r = reponse || {};
  if (!PV_RECEPTION_TYPES.includes(r.reception_type)) return 'choix_requis';
  const nom = String(r.signataire_nom ?? '').trim();
  if (!nom || nom.length > PV_NOM_MAX) return 'nom_requis';
  const signature = String(r.signature_png ?? '');
  if (!signature.startsWith(PREFIXE_PNG) || signature.length < PV_SIGNATURE_MIN || signature.length > PV_SIGNATURE_MAX) {
    return 'signature_requise';
  }
  const nature = String(r.reserves_nature ?? '').trim();
  const travaux = String(r.reserves_travaux ?? '').trim();
  if (r.reception_type === 'avec_reserves' && !nature) return 'reserves_a_decrire';
  if (nature.length > PV_TEXTE_MAX || travaux.length > PV_TEXTE_MAX) return 'texte_trop_long';
  return null;
}

/**
 * Valide la signature de la levée des réserves (nom et image), mêmes bornes que le PV.
 * @param {Object|null|undefined} reponse
 * @returns {string|null} code du refus, ou `null`
 */
export function validerReponseLevee(reponse) {
  const r = reponse || {};
  const nom = String(r.signataire_nom ?? '').trim();
  if (!nom || nom.length > PV_NOM_MAX) return 'nom_requis';
  const signature = String(r.signature_png ?? '');
  if (!signature.startsWith(PREFIXE_PNG) || signature.length < PV_SIGNATURE_MIN || signature.length > PV_SIGNATURE_MAX) {
    return 'signature_requise';
  }
  return null;
}

/**
 * Valide la réponse du bureau aux réserves : une description et/ou une date prévue.
 * @param {{ reponse?: string|null, echeance?: string|null }} saisie
 * @param {string} jourSignature jour de signature du PV, `YYYY-MM-DD`
 * @returns {string|null} code du refus, ou `null`
 */
export function validerReponseReserves(saisie, jourSignature) {
  const s = saisie || {};
  const reponse = String(s.reponse ?? '').trim();
  const echeance = String(s.echeance ?? '').trim();
  if (!reponse && !echeance) return 'reponse_vide';
  if (reponse.length > PV_TEXTE_MAX) return 'texte_trop_long';
  if (echeance) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(echeance);
    if (!m) return 'echeance_invalide';
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
      return 'echeance_invalide';
    }
    if (echeance < String(jourSignature ?? '')) return 'echeance_invalide';
  }
  return null;
}

/**
 * Réponse nettoyée, telle qu'elle part à la RPC : textes rognés, réserves vidées pour une
 * réception sans réserve, clés des points confirmés nettoyées (30 au plus).
 * @param {Object} reponse
 * @returns {Object}
 */
export function normaliserReponsePv(reponse) {
  const r = reponse || {};
  const avecReserves = r.reception_type === 'avec_reserves';
  const confirmes = Array.isArray(r.points_confirmes) ? r.points_confirmes : [];
  const points = [...new Set(confirmes.filter((k) => typeof k === 'string').map((k) => k.trim()).filter(Boolean))].slice(0, 30);
  return {
    reception_type: r.reception_type,
    signataire_nom: String(r.signataire_nom ?? '').trim(),
    signature_png: String(r.signature_png ?? ''),
    reserves_nature: avecReserves ? String(r.reserves_nature ?? '').trim() : '',
    reserves_travaux: avecReserves ? String(r.reserves_travaux ?? '').trim() : '',
    points_confirmes: points,
  };
}

/**
 * Objet des travaux sur une ligne : type d'équipement et libellé du chantier.
 * @param {{ equipement?: string|null, libelle?: string|null }} p
 * @returns {string}
 */
export function objetDuPv({ equipement, libelle } = {}) {
  const type = String(equipement ?? '').trim();
  const texte = String(libelle ?? '').trim();
  if (type && texte && type.toLowerCase() === texte.toLowerCase()) return type;
  return [type, texte].filter(Boolean).join(' · ') || 'Installation';
}

/** `YYYY-MM-DD` → « 4 novembre 2026 » (construit en UTC : pas de glissement de jour). */
export function dateLongue(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(d).replace(/^1 /, '1er ');
}

/**
 * Jours de pose en une phrase : « le 4 novembre 2026 » pour un jour, sinon les bornes
 * (« du 3 novembre 2026 au 5 novembre 2026 »), que les jours se suivent ou non.
 * @param {string[]|null|undefined} poses dates `YYYY-MM-DD`
 * @returns {string} chaîne vide si aucun jour
 */
export function periodeDePose(poses) {
  const jours = [...new Set((poses || []).filter(Boolean))].sort();
  if (jours.length === 0) return '';
  if (jours.length === 1) return `le ${dateLongue(jours[0])}`;
  return `du ${dateLongue(jours[0])} au ${dateLongue(jours[jours.length - 1])}`;
}

/** Horodatage ISO → `YYYY-MM-DD` à l'heure de Paris (jour où le client a signé). */
export function jourDeParis(horodatage) {
  const d = new Date(horodatage);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d);
  const v = (t) => p.find((x) => x.type === t)?.value || '';
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/**
 * Données du PDF du PV (`generatePvReceptionPdfBlob`) depuis l'enregistrement de la signature en
 * ligne. Même document côté bureau (« Voir le PV ») et côté client (« Télécharger mon PV ») :
 * les deux lisent l'ENREGISTREMENT, rien n'est recalculé.
 * @param {Object} p
 * @param {string} p.chantierId
 * @param {{ prenom?: string, nom?: string, adresse?: string, code_postal?: string, ville?: string }} p.client
 * @param {string} p.objet            objet des travaux (`objetDuPv`)
 * @param {string} p.entreprise       nom de l'entreprise (case « Signature de l'entreprise »)
 * @param {Object} p.signature        ligne `chantier_pv` signée
 * @returns {Object}
 */
export function donneesPdfPv({ chantierId, client, objet, entreprise, signature }) {
  const c = client || {};
  const s = signature || {};
  const avecReserves = s.reception_type === 'avec_reserves';
  const pointsClient = Array.isArray(s.points_client) ? s.points_client : null;
  return {
    pvNumber: `PV-${String(chantierId || '').slice(0, 8).toUpperCase()}`,
    pvDate: dateLongue(jourDeParis(s.signed_at)),
    clientName: [c.nom, c.prenom].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ') || 'Client',
    clientAddress: c.adresse || '-',
    clientPostalCode: c.code_postal || '',
    clientCity: c.ville || '',
    clientPhone: '',
    clientEmail: '',
    equipmentLabel: objet || 'Installation',
    equipmentRef: null,
    orderAmountHT: null,
    technicianName: entreprise || '',
    receptionType: s.reception_type,
    reservesNature: avecReserves ? s.reserves_nature || null : null,
    reservesTravaux: avecReserves ? s.reserves_travaux || null : null,
    // Cases d'avant : lues seulement pour un PV sans `points_client` (signé sur tablette).
    infoRecues: !pointsClient && s.info_recues === true,
    noticesRecues: !pointsClient && s.notices_recues === true,
    entretienRecues: !pointsClient && s.entretien_recues === true,
    devis: devisEnMots(s.devis),
    pointsEntreprise: (Array.isArray(s.points_entreprise) ? s.points_entreprise : []).map((p) => ({
      texte: p.texte,
      reponse: String(p.reponse ?? '').replace('_', ' '),
    })),
    pointsClient: (pointsClient || []).map((p) => ({ texte: p.texte, confirme: p.confirme === true })),
    signatureClientBase64: s.signature_png || null,
    signatureClientNom: s.signataire_nom || '',
    signatureTechBase64: null,
    signatureTechNom: entreprise || '',
    lieu: c.ville || '',
  };
}

/**
 * Données du PDF de levée des réserves, depuis la ligne `chantier_pv` (réserves, réponse du
 * bureau, signature de la levée). Rien n'est recalculé.
 * @param {Object} p
 * @param {string} p.chantierId
 * @param {{ prenom?: string, nom?: string, adresse?: string, code_postal?: string, ville?: string }} p.client
 * @param {string} p.objet        objet des travaux (`objetDuPv`)
 * @param {string} p.entreprise   nom de l'entreprise
 * @param {Object} p.pv           ligne `chantier_pv` dont la levée est signée
 * @returns {Object}
 */
export function donneesPdfLevee({ chantierId, client, objet, entreprise, pv }) {
  const c = client || {};
  const s = pv || {};
  return {
    numero: `LR-${String(chantierId || '').slice(0, 8).toUpperCase()}`,
    date: dateLongue(jourDeParis(s.levee_signed_at)),
    pvNumber: `PV-${String(chantierId || '').slice(0, 8).toUpperCase()}`,
    pvDate: dateLongue(jourDeParis(s.signed_at)),
    clientName: [c.nom, c.prenom].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ') || 'Client',
    clientAddress: c.adresse || '-',
    clientPostalCode: c.code_postal || '',
    clientCity: c.ville || '',
    equipmentLabel: objet || 'Installation',
    devis: devisEnMots(s.devis),
    reservesNature: s.reserves_nature || null,
    reservesTravaux: s.reserves_travaux || null,
    reponse: s.reserves_reponse || null,
    echeance: s.reserves_echeance ? dateLongue(s.reserves_echeance) : null,
    signatureNom: s.levee_signataire_nom || '',
    signatureBase64: s.levee_signature_png || null,
    entreprise: entreprise || '',
    lieu: c.ville || '',
  };
}

/**
 * Ligne d'un devis cité au PV (écran et PDF) : « Devis X du <date> », « Devis X »,
 * « Devis du <date> », ou rien si les deux manquent.
 * @param {string|null|undefined} libelle numéro du devis
 * @param {string|null|undefined} date date déjà en toutes lettres
 * @returns {string}
 */
export function ligneDevis(libelle, date) {
  const l = String(libelle ?? '').trim();
  const d = String(date ?? '').trim();
  if (!l && !d) return '';
  return ['Devis', l, d ? `du ${d}` : ''].filter(Boolean).join(' ');
}

/** Devis cités au PV : date en toutes lettres. */
function devisEnMots(devis) {
  return (Array.isArray(devis) ? devis : []).map((d) => ({ libelle: d.libelle, date: dateLongue(d.date) }));
}
