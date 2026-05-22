/**
 * orgBranding.js — Helper multi-tenant pour le branding entreprise
 *
 * Construit l'objet `companyInfo` consommé par les PDFs et les composants email.
 *
 * Source : core.organizations.settings (chargé via useAuth().organization).
 * Fallback : valeurs **neutres** (pas Mayer) — les orgs sans settings voient
 * "Votre entreprise" / champs vides / couleur neutre, pas Mayer Énergie.
 *
 * Cf docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md §9.1
 */

// portal_url est une constante app (singleton) tant qu'on n'a pas de sous-domaines par org.
const APP_PORTAL_URL = 'https://majordhome.vercel.app';

const NEUTRAL_DEFAULTS = {
  name: 'Votre entreprise',
  legalName: '',
  legalForm: '',
  capital: '',
  rcs: '',
  siret: '',
  tvaIntra: '',
  address: '',
  postalCode: '',
  city: '',
  phone: '',
  email: '',
  domain: '',                          // calculé via from_email.split('@')[1]
  websiteUrl: '',
  portalUrl: APP_PORTAL_URL,           // constante app
  unsubscribeLandingUrl: '',
  insurance: '',
  logoUrl: '',                         // pas de logo placeholder = pas d'<img>
  accentColor: '#64748b',              // slate-500 (neutre)
  rgeCertifications: [],
};

/**
 * Construit l'objet companyInfo depuis les settings de l'organisation.
 * Tout champ manquant retombe sur NEUTRAL_DEFAULTS (pas Mayer).
 *
 * @param {Object|null} settings - core.organizations.settings JSONB
 * @returns {Object} companyInfo prêt pour PDFs/emails
 */
export function buildCompanyInfo(settings) {
  const s = settings || {};
  const fromEmail = s.from_email || NEUTRAL_DEFAULTS.email;
  return {
    name: s.brand_name || NEUTRAL_DEFAULTS.name,
    legalName: s.legal_name || s.brand_name || NEUTRAL_DEFAULTS.legalName,
    legalForm: s.legal_form || NEUTRAL_DEFAULTS.legalForm,
    capital: s.capital || NEUTRAL_DEFAULTS.capital,
    rcs: s.rcs || NEUTRAL_DEFAULTS.rcs,
    siret: s.siret || NEUTRAL_DEFAULTS.siret,
    tvaIntra: s.tva_intra || NEUTRAL_DEFAULTS.tvaIntra,
    address: s.address || NEUTRAL_DEFAULTS.address,
    postalCode: s.postal_code || NEUTRAL_DEFAULTS.postalCode,
    city: s.city || NEUTRAL_DEFAULTS.city,
    phone: s.phone || NEUTRAL_DEFAULTS.phone,
    email: fromEmail,
    domain: fromEmail ? (fromEmail.split('@')[1] || NEUTRAL_DEFAULTS.domain) : NEUTRAL_DEFAULTS.domain,
    websiteUrl: s.website_url || NEUTRAL_DEFAULTS.websiteUrl,
    portalUrl: APP_PORTAL_URL,         // constante, jamais lu depuis settings
    unsubscribeLandingUrl: s.unsubscribe_landing_url || NEUTRAL_DEFAULTS.unsubscribeLandingUrl,
    insurance: s.insurance || NEUTRAL_DEFAULTS.insurance,
    logoUrl: s.logo_url || NEUTRAL_DEFAULTS.logoUrl,
    accentColor: s.accent_color || NEUTRAL_DEFAULTS.accentColor,
    rgeCertifications: Array.isArray(s.rge_certifications) ? s.rge_certifications : NEUTRAL_DEFAULTS.rgeCertifications,
  };
}

/** Adresse complète "rue – CP ville" pour les en-têtes / footers PDF */
export function formatFullAddress(company) {
  const parts = [];
  if (company.address) parts.push(company.address);
  if (company.postalCode || company.city) {
    parts.push(`${company.postalCode || ''} ${company.city || ''}`.trim());
  }
  return parts.join(' – ');
}

/** Mention légale standard pour les footers PDF */
export function buildLegalFooter(company) {
  const parts = [];
  if (company.legalName) parts.push(company.legalName);
  if (company.legalForm) parts.push(company.legalForm);
  if (company.capital) parts.push(`capital ${company.capital} €`);
  if (company.rcs) parts.push(company.rcs);
  const address = formatFullAddress(company);
  if (address) parts.push(address);
  if (company.email) parts.push(company.email);
  return parts.join(' — ');
}
