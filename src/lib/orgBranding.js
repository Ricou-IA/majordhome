/**
 * orgBranding.js — Helper multi-tenant pour le branding entreprise
 * ============================================================================
 *
 * Construit l'objet `companyInfo` consommé par les PDFs (ContractPDF,
 * CertificatPDF, DevisPDF, PvReceptionPDF) et les composants d'email.
 *
 * Source : `core.organizations.settings` (chargé via useAuth().organization).
 * Fallback : valeurs Mayer Énergie pour rétrocompat (avant que tous les
 * callers ne passent les settings explicitement).
 *
 * Usage typique :
 *   const { organization } = useAuth();
 *   const company = buildCompanyInfo(organization?.settings);
 *   const blob = await generateContractPdfBlob({ data, company });
 *
 * Pour la 2ème entreprise : suffit d'enrichir `core.organizations.settings`
 * pour la nouvelle org — pas de code à toucher.
 * ============================================================================
 */

const MAYER_DEFAULTS = {
  name: 'Mayer Énergie',
  legalName: 'MAYER ENERGIE',
  legalForm: 'SAS à associé unique',
  capital: '6 000',
  rcs: '100 288 224 R.C.S. Albi',
  siret: '100 288 224 00015',
  tvaIntra: 'FR 06 449776916',
  address: '26 Rue des Pyrénées',
  postalCode: '81600',
  city: 'Gaillac',
  phone: '05 63 33 23 14',
  email: 'contact@mayer-energie.fr',
  domain: 'mayer-energie.fr',
  websiteUrl: 'https://www.mayer-energie.fr',
  portalUrl: 'https://majordhome.vercel.app',
  unsubscribeLandingUrl: 'https://www.mayer-energie.fr/desabonnement',
  insurance: 'Couvert par une assurance responsabilité civile professionnelle',
  logoUrl: 'https://www.mayer-energie.fr/images/logo-email.png',
  accentColor: '#f97316',
  rgeCertifications: ['QualiPAC', 'QualiBois'],
};

/**
 * Construit un objet companyInfo depuis les settings de l'organisation.
 * Si settings est null/undefined ou si un champ est manquant, fallback Mayer.
 *
 * @param {Object|null} settings - core.organizations.settings JSONB
 * @returns {Object} companyInfo prêt à être consommé par les PDFs/emails
 */
export function buildCompanyInfo(settings) {
  const s = settings || {};
  return {
    name: s.brand_name || MAYER_DEFAULTS.name,
    legalName: s.legal_name || MAYER_DEFAULTS.legalName,
    legalForm: s.legal_form || MAYER_DEFAULTS.legalForm,
    capital: s.capital || MAYER_DEFAULTS.capital,
    rcs: s.rcs || MAYER_DEFAULTS.rcs,
    siret: s.siret || MAYER_DEFAULTS.siret,
    tvaIntra: s.tva_intra || MAYER_DEFAULTS.tvaIntra,
    address: s.address || MAYER_DEFAULTS.address,
    postalCode: s.postal_code || MAYER_DEFAULTS.postalCode,
    city: s.city || MAYER_DEFAULTS.city,
    phone: s.phone || MAYER_DEFAULTS.phone,
    email: s.from_email || MAYER_DEFAULTS.email,
    domain: s.domain || MAYER_DEFAULTS.domain,
    websiteUrl: s.website_url || MAYER_DEFAULTS.websiteUrl,
    portalUrl: s.portal_url || MAYER_DEFAULTS.portalUrl,
    unsubscribeLandingUrl: s.unsubscribe_landing_url || MAYER_DEFAULTS.unsubscribeLandingUrl,
    insurance: s.insurance || MAYER_DEFAULTS.insurance,
    logoUrl: s.logo_url || MAYER_DEFAULTS.logoUrl,
    accentColor: s.accent_color || MAYER_DEFAULTS.accentColor,
    rgeCertifications: s.rge_certifications || MAYER_DEFAULTS.rgeCertifications,
  };
}

/** Adresse complète "rue – CP ville" pour les en-têtes / footers PDF */
export function formatFullAddress(company) {
  return `${company.address} – ${company.postalCode} ${company.city}`;
}

/** Mention légale standard pour les footers PDF */
export function buildLegalFooter(company) {
  return `${company.legalName} — ${company.legalForm}, capital ${company.capital} € — ${company.rcs} — ${formatFullAddress(company)} — ${company.email}`;
}
