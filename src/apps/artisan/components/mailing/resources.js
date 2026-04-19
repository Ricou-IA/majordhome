/**
 * resources.js — Caisse à outils URLs/ressources Mayer Énergie pour le mailing
 * ============================================================================
 *
 * 📌 SOURCE DE VÉRITÉ — À METTRE À JOUR À CHAQUE NOUVELLE RESSOURCE
 *
 * Catalogue centralisé des URLs réelles, edge functions et ressources métier
 * que l'IA peut référencer dans le HTML généré (évite les URLs fictives).
 *
 * 👉 Pour ajouter une ressource, ajoute juste une entrée dans l'objet `RESOURCES`
 * ci-dessous. Elle apparaîtra automatiquement dans le prompt envoyé à Claude
 * (via la section "Caisse à outils" injectée par buildPrompt).
 *
 * Convention :
 *   - `key`    : identifiant snake_case (ex: avis_google, parrainage)
 *   - `label`  : nom court humain
 *   - `url`    : URL de base (sans UTM ni query param variable)
 *   - `category` : 'cta' | 'service' | 'info' | 'blog' | 'zone' | 'contact' | 'legal' | 'workflow' (workflow = exclu du prompt)
 *   - `usage`  : quand l'IA doit utiliser cette ressource (1-2 phrases)
 *   - `notes`  : (optionnel) contraintes spécifiques (substitutions, auth, etc.)
 *
 * Le placeholder `{CAMPAIGN_KEY}` dans une URL ou un usage sera remplacé
 * automatiquement par la clé de la campagne courante au moment du prompt.
 * ============================================================================
 */

export const RESOURCES = {
  // ---------------------------------------------------------------------------
  // CTA & engagement (boutons principaux)
  // ---------------------------------------------------------------------------
  contact: {
    label: 'Contact / Devis gratuit',
    url: 'https://www.mayer-energie.fr/contact',
    category: 'cta',
    usage: "CTA par défaut du bloc « Un projet en cours ? ». Sert aussi pour les demandes de devis. Ajoute toujours les UTM utm_source=emailing&utm_campaign={CAMPAIGN_KEY}&utm_medium=email.",
  },
  depannage_sav: {
    label: 'Dépannage / SAV',
    url: 'https://www.mayer-energie.fr/depannage-sav',
    category: 'cta',
    usage: "Pour une demande d'intervention urgente, panne, ou suivi SAV. À privilégier dans un mail post-installation ou de relance technique.",
  },
  entretien: {
    label: 'Contrats d\'entretien',
    url: 'https://www.mayer-energie.fr/entretien',
    category: 'cta',
    usage: "Pour proposer la souscription d'un contrat d'entretien annuel. Pertinent en post-installation ou en relance clients sans contrat.",
  },
  espace_client: {
    label: 'Espace client',
    url: 'https://www.mayer-energie.fr/espace-client',
    category: 'cta',
    usage: "Lien vers le portail client Mayer (suivi équipements, factures, RDV). Pertinent en mail de fidélisation ou onboarding.",
  },
  simulateur_aides: {
    label: 'Simulateur MaPrimeRénov\' / aides',
    url: 'https://www.mayer-energie.fr/simulateur-prime-renov',
    category: 'cta',
    usage: "Pour faire calculer les aides financières disponibles (MaPrimeRénov', CEE, TVA réduite). Parfait en relance devis ou mail sur les travaux de rénovation énergétique.",
  },
  avis_google: {
    label: 'Avis Google (redirect tracké)',
    url: 'https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/avis-redirect',
    category: 'cta',
    usage: "Pour inviter un client à laisser un avis Google. Redirige vers la fiche Google Reviews de Mayer (g.page/r/CX5QpYfID75jEBM/review).",
    notes: "Accepte un param ?log_id=... pour tracking SMS ; pas nécessaire pour le mail car Resend tracke déjà les clics.",
  },
  parrainage: {
    label: 'Programme parrainage',
    url: 'https://www.mayer-energie.fr/contact',
    category: 'cta',
    usage: "Pour pousser le parrainage (avantages parrain + filleul). Pas de page dédiée pour l'instant — utiliser le formulaire contact en attendant.",
    notes: "⚠️ TODO : remplacer par /parrainage dès qu'une page dédiée sera publiée.",
  },

  // ---------------------------------------------------------------------------
  // Pages services (peuvent servir de thèmes / liens vers offre détaillée)
  // ---------------------------------------------------------------------------
  service_pompe_a_chaleur: {
    label: 'Pompe à chaleur',
    url: 'https://www.mayer-energie.fr/pompe-a-chaleur',
    category: 'service',
    usage: "Page détail PAC. À citer pour pousser une PAC ou détailler une offre.",
  },
  service_climatisation: {
    label: 'Climatisation',
    url: 'https://www.mayer-energie.fr/climatisation',
    category: 'service',
    usage: "Page détail climatisation. Pertinent au printemps/début d'été ou pour offres préparation été.",
  },
  service_poele_granules: {
    label: 'Poêle à granulés',
    url: 'https://www.mayer-energie.fr/poele-a-granules',
    category: 'service',
    usage: "Page détail poêle à granulés. Pertinent en automne, ou avec offre combustible TotalEnergies.",
  },
  service_poele_bois: {
    label: 'Poêle à bois',
    url: 'https://www.mayer-energie.fr/poele-a-bois',
    category: 'service',
    usage: "Page détail poêle à bois. Pertinent en automne ou pour rénovation énergétique.",
  },
  service_chaudiere_fioul: {
    label: 'Remplacement chaudière fioul',
    url: 'https://www.mayer-energie.fr/remplacement-chaudiere-fioul',
    category: 'service',
    usage: "Page détail remplacement chaudière fioul (interdit depuis 2022). À citer pour propriétaires anciens systèmes.",
  },
  service_photovoltaique: {
    label: 'Photovoltaïque',
    url: 'https://www.mayer-energie.fr/photovoltaique',
    category: 'service',
    usage: "Page détail panneaux solaires. Pour offres ou conseils sur autoconsommation, revente.",
  },
  service_electricite: {
    label: 'Électricité',
    url: 'https://www.mayer-energie.fr/electricite',
    category: 'service',
    usage: "Page détail travaux électricité. Pour mise aux normes, rénovation, etc.",
  },

  // ---------------------------------------------------------------------------
  // Articles de blog (sujets éditoriaux pour conseils ou newsletter)
  // ---------------------------------------------------------------------------
  blog_index: {
    label: 'Blog (index)',
    url: 'https://www.mayer-energie.fr/blog',
    category: 'blog',
    usage: "Lien vers tous les articles. À mettre en bas d'un mail pour inviter à découvrir nos contenus.",
  },
  blog_degres_jours: {
    label: 'Article — Degrés-jours et facture chauffage',
    url: 'https://www.mayer-energie.fr/blog/degres-jours-chauffage-climatisation',
    category: 'blog',
    usage: "Pour expliquer pourquoi la facture varie selon l'hiver. Utile en mail conseil sur l'optimisation énergétique.",
  },
  blog_chaudiere_fioul: {
    label: 'Article — Remplacement chaudière fioul Tarn',
    url: 'https://www.mayer-energie.fr/blog/remplacement-chaudiere-fioul-tarn',
    category: 'blog',
    usage: "Pour rappeler l'interdiction du fioul + alternatives. Cible : clients avec ancienne chaudière fioul.",
  },
  blog_choix_poele_bois: {
    label: 'Article — Guide choix poêle à bois 2026',
    url: 'https://www.mayer-energie.fr/blog/guide-choix-poele-bois',
    category: 'blog',
    usage: "Guide d'achat poêle à bois. Pertinent en automne ou pour conseiller un primo-acquéreur.",
  },
  blog_prix_pac: {
    label: 'Article — Prix pompe à chaleur 2026',
    url: 'https://www.mayer-energie.fr/blog/prix-pompe-a-chaleur-2026',
    category: 'blog',
    usage: "Référence sur les tarifs PAC. À citer en lien dans une relance devis ou un comparatif.",
  },
  blog_poele_comparatif: {
    label: 'Article — Poêle bois vs granulés (comparatif)',
    url: 'https://www.mayer-energie.fr/blog/poele-bois-vs-granules-comparatif',
    category: 'blog',
    usage: "Comparatif éditorial. Aide à orienter un client hésitant.",
  },
  blog_aides_2026: {
    label: 'Article — Aides chauffage 2026 (Tarn)',
    url: 'https://www.mayer-energie.fr/blog/aides-chauffage-2026-tarn',
    category: 'blog',
    usage: "Récap des aides actuelles. À citer en complément du simulateur MaPrimeRénov'.",
  },
  blog_dpe: {
    label: 'Article — DPE / Diagnostic Performance Énergétique',
    url: 'https://www.mayer-energie.fr/blog/dpe-diagnostic-performance-energetique',
    category: 'blog',
    usage: "Pour expliquer le DPE. Utile pour proprios envisageant rénovation ou vente.",
  },
  blog_vendre_bien: {
    label: 'Article — Diagnostics obligatoires pour vendre',
    url: 'https://www.mayer-energie.fr/blog/vendre-son-bien-immobilier-diagnostics',
    category: 'blog',
    usage: "Diagnostics immo obligatoires. À citer pour clients en projet de vente ou succession.",
  },
  blog_confort_thermique: {
    label: 'Article — Améliorer le confort thermique',
    url: 'https://www.mayer-energie.fr/blog/confort-thermique-habitat',
    category: 'blog',
    usage: "Conseils pratiques sur le confort. Bon angle pour newsletter ou mail saisonnier.",
  },

  // ---------------------------------------------------------------------------
  // Zones d'intervention (utile pour mails géo-localisés)
  // ---------------------------------------------------------------------------
  zone_gaillac: { label: 'Zone Gaillac', url: 'https://www.mayer-energie.fr/zone-intervention/gaillac', category: 'zone', usage: "Page locale Gaillac (siège). Pour mail clients du Tarn." },
  zone_albi: { label: 'Zone Albi', url: 'https://www.mayer-energie.fr/zone-intervention/albi', category: 'zone', usage: "Page locale Albi." },
  zone_toulouse: { label: 'Zone Toulouse', url: 'https://www.mayer-energie.fr/zone-intervention/toulouse', category: 'zone', usage: "Page locale Toulouse / Haute-Garonne." },
  zone_montauban: { label: 'Zone Montauban', url: 'https://www.mayer-energie.fr/zone-intervention/montauban', category: 'zone', usage: "Page locale Montauban / Tarn-et-Garonne." },
  zone_castres: { label: 'Zone Castres', url: 'https://www.mayer-energie.fr/zone-intervention/castres', category: 'zone', usage: "Page locale Castres." },
  zone_lavaur: { label: 'Zone Lavaur', url: 'https://www.mayer-energie.fr/zone-intervention/lavaur', category: 'zone', usage: "Page locale Lavaur." },
  zone_carmaux: { label: 'Zone Carmaux', url: 'https://www.mayer-energie.fr/zone-intervention/carmaux', category: 'zone', usage: "Page locale Carmaux." },
  zone_rabastens: { label: 'Zone Rabastens', url: 'https://www.mayer-energie.fr/zone-intervention/rabastens', category: 'zone', usage: "Page locale Rabastens." },
  zone_graulhet: { label: 'Zone Graulhet', url: 'https://www.mayer-energie.fr/zone-intervention/graulhet', category: 'zone', usage: "Page locale Graulhet." },
  zone_mazamet: { label: 'Zone Mazamet', url: 'https://www.mayer-energie.fr/zone-intervention/mazamet', category: 'zone', usage: "Page locale Mazamet." },

  // ---------------------------------------------------------------------------
  // Pages institutionnelles
  // ---------------------------------------------------------------------------
  site: {
    label: 'Site web Mayer Énergie',
    url: 'https://www.mayer-energie.fr',
    category: 'info',
    usage: "Lien générique vers la home. À citer dans un paragraphe « En savoir plus » ou la signature.",
  },
  a_propos: {
    label: 'À propos / Présentation',
    url: 'https://www.mayer-energie.fr/a-propos',
    category: 'info',
    usage: "Page présentation entreprise (équipe, valeurs, certifications). Utile pour un mail de bienvenue ou de présentation.",
  },

  // ---------------------------------------------------------------------------
  // Légal (footer)
  // ---------------------------------------------------------------------------
  mentions_legales: {
    label: 'Mentions légales',
    url: 'https://www.mayer-energie.fr/mentions-legales',
    category: 'legal',
    usage: "À citer dans le footer si nécessaire pour conformité.",
  },
  confidentialite: {
    label: 'Politique de confidentialité',
    url: 'https://www.mayer-energie.fr/politique-confidentialite',
    category: 'legal',
    usage: "À citer dans le footer pour conformité RGPD.",
  },

  // ---------------------------------------------------------------------------
  // Contacts directs (header / footer / sous CTA)
  // ---------------------------------------------------------------------------
  telephone: {
    label: 'Téléphone Mayer Énergie',
    url: 'tel:+33563332314',
    display: '05 63 33 23 14',
    category: 'contact',
    usage: "Lien cliquable sur mobile. À mettre sous le CTA contact et dans le footer.",
  },
  email_contact: {
    label: 'Email contact Mayer Énergie',
    url: 'mailto:contact@mayer-energie.fr',
    display: 'contact@mayer-energie.fr',
    category: 'contact',
    usage: "Lien mailto pour réponse écrite. À mettre dans le footer.",
  },

  // ---------------------------------------------------------------------------
  // Ressources spécifiques (campagnes particulières)
  // ---------------------------------------------------------------------------
  offre_pellets: {
    label: 'Offre combustible TotalEnergies',
    url: 'https://www.mayer-energie.fr/offre-pellets',
    category: 'cta',
    usage: "CTA spécifique à la campagne Mail H (combustible). Nécessite un token client unique.",
    notes: "Utiliser avec `?token={{token}}` où token = colonne `clients.pellets_total_token`. Dans le workflow N8N, le placeholder `{{lien_pellets}}` est substitué par l'URL complète.",
  },

  // ---------------------------------------------------------------------------
  // Workflows internes (référence — pas injecté dans le prompt)
  // ---------------------------------------------------------------------------
  webhook_sms_avis: {
    label: 'Workflow N8N — SMS Avis J+1',
    url: null,
    category: 'workflow',
    usage: "Déclenché côté app (pas dans un mail). Envoi SMS/WhatsApp avec lien avis-redirect pour tracking.",
  },
  webhook_mailing: {
    label: 'Workflow N8N — Envoi mailing',
    url: null,
    category: 'workflow',
    usage: "Point d'entrée des envois de campagnes mail. Pas utilisé dans le HTML.",
  },
};

/**
 * Formate la caisse à outils en section Markdown pour injection dans le prompt.
 * Seules les ressources avec url non nulle et category différente de 'workflow' sont incluses.
 */
export function formatResourcesForPrompt() {
  const lines = [];
  lines.push('## Caisse à outils — URLs et ressources disponibles');
  lines.push('');
  lines.push("Utilise ces URLs **exactes** dans le HTML (plutôt que d'inventer). Pour un CTA, ajoute toujours les UTM : `utm_source=emailing&utm_campaign={CAMPAIGN_KEY}&utm_medium=email`.");
  lines.push('');

  const byCategory = {};
  for (const [key, r] of Object.entries(RESOURCES)) {
    if (!r.url || r.category === 'workflow') continue;
    if (!byCategory[r.category]) byCategory[r.category] = [];
    byCategory[r.category].push({ key, ...r });
  }

  const CATEGORY_LABELS = {
    cta: 'Boutons CTA (actions principales)',
    service: 'Pages services Mayer (offres détaillées)',
    blog: 'Articles de blog (contenus éditoriaux)',
    zone: "Pages d'intervention locales",
    info: 'Pages institutionnelles',
    legal: 'Pages légales',
    contact: 'Contacts directs',
  };

  // Ordre d'affichage stable
  const order = ['cta', 'service', 'blog', 'zone', 'info', 'legal', 'contact'];
  for (const cat of order) {
    const items = byCategory[cat];
    if (!items?.length) continue;
    lines.push(`### ${CATEGORY_LABELS[cat] || cat}`);
    for (const r of items) {
      lines.push(`- **\`${r.key}\`** — ${r.label}`);
      lines.push(`  URL : \`${r.url}\``);
      lines.push(`  Quand : ${r.usage}`);
      if (r.notes) lines.push(`  Notes : ${r.notes}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
