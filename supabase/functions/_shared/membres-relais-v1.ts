// ---------------------------------------------------------------------------
// Contrat Membres v1 — le relais de référence, pour un site en modèle
// « organisations » qui a sa propre base.
// Spec : docs/superpowers/specs/2026-11-20-contrat-membres-design.md.
//
// Ce que le contrat règle : les comptes d'un site vivent dans l'authentification
// du site. Baikal n'en tient aucune copie ; il demande au site la liste et lui
// demande d'exécuter chaque geste.
//
// Installer chez un site :
//   1. copier ce fichier tel quel dans supabase/functions/_shared/ ;
//   2. écrire l'objet `SiteMembres` du site : ses rôles, `lister`, et une
//      méthode par geste qu'il sait faire PROPREMENT (création complète comme
//      depuis son propre écran, pas un compte nu). Une méthode absente = une
//      action non publiée = pas de bouton dans Baikal ;
//   3. dans l'EF d'administration du site (celle que nomme
//      config.apps.env_admin_fn, protégée par X-Baikal-Key) :
//        - ajouter `membres: blocManifeste(site)` à la réponse de `manifeste` ;
//        - router toute action reconnue par `estActionMembres` vers
//          `traiterMembres(body, site)` et rendre { statut, corps } tel quel.
//
// Ce fichier ne contient AUCUNE logique métier : il valide la forme du corps,
// nomme les erreurs et distribue. C'est le site qui sait ce qu'est un membre
// chez lui.
//
// Contrat HTTP (appelé par l'EF admin-membres de Baikal via _shared/relais.ts) :
//   POST { action: "membres", org_id? }
//     -> 200 { organisations: [{ id, nom }], membres: [Membre] }
//   POST { action: "membre-creer", email, mot_de_passe, nom?, org_id, role, auteur? }
//     -> 200 { membre }
//   POST { action: "membre-role", id, role, auteur? }            -> 200 { membre }
//   POST { action: "membre-mot-de-passe", id, mot_de_passe, auteur? } -> 200 { ok: true }
//   POST { action: "membre-lien", id, auteur? }                  -> 200 { lien }
//   POST { action: "membre-renommer", id, nom, auteur? }         -> 200 { membre }
//   POST { action: "membre-email", id, email, auteur? }          -> 200 { membre }
//   POST { action: "membre-bloquer", id, bloque, auteur? }       -> 200 { membre }
//   POST { action: "membre-retirer", id, auteur? }               -> 200 { ok: true }
//   Erreur -> { error: <code>, detail? } ; codes dans CODES ci-dessous.
//
// Ce que le site garantit (le relais ne peut pas le vérifier à sa place) :
//   - `lister` ne rend que les membres de SES organisations, même si sa base
//     porte les comptes d'autres produits ;
//   - une cible hors de ses organisations lève `membre_inconnu`, sans dire si
//     l'adresse existe ailleurs ;
//   - `creer` est idempotente : une adresse déjà inscrite et sans organisation
//     est complétée, une adresse membre d'une autre organisation lève
//     `deja_membre` ;
//   - le mot de passe n'est ni stocké ni journalisé ; `auteur` l'est.
// ---------------------------------------------------------------------------

export const VERSION_MEMBRES = 1;

export const CODES = {
  invalid_body: 400,
  action_inconnue: 400,
  role_inconnu: 400,
  mot_de_passe_trop_court: 400,
  org_inconnue: 404,
  membre_inconnu: 404,
  deja_membre: 409,
  erreur_interne: 500,
} as const;
export type CodeErreur = keyof typeof CODES;

/** À lever depuis les méthodes du site : le relais en fait la réponse HTTP. */
export class ErreurMembres extends Error {
  constructor(readonly code: CodeErreur, readonly detail?: string) {
    super(code);
  }
}

export type Role = { slug: string; libelle: string };

export type Membre = {
  id: string;
  email: string;
  nom: string | null;
  org_id: string;
  role: string;
  cree_le: string | null;
  derniere_connexion: string | null;
  bloque: boolean;
};

export type Liste = {
  organisations: Array<{ id: string; nom: string | null }>;
  membres: Membre[];
};

type Cible = { id: string; auteur: string | null };
export type Creation = {
  email: string;
  mot_de_passe: string;
  nom: string | null;
  org_id: string;
  role: string;
  auteur: string | null;
};

export interface SiteMembres {
  roles: Role[];
  lister(orgId: string | null): Promise<Liste>;
  creer?(d: Creation): Promise<Membre>;
  changerRole?(d: Cible & { role: string }): Promise<Membre>;
  changerMotDePasse?(d: Cible & { mot_de_passe: string }): Promise<void>;
  lienReinitialisation?(d: Cible): Promise<string>;
  renommer?(d: Cible & { nom: string }): Promise<Membre>;
  changerEmail?(d: Cible & { email: string }): Promise<Membre>;
  bloquer?(d: Cible & { bloque: boolean }): Promise<Membre>;
  retirer?(d: Cible): Promise<void>;
}

// Action du contrat -> méthode du site. L'ordre est celui du manifeste.
const METHODES: ReadonlyArray<[string, keyof SiteMembres]> = [
  ["membres", "lister"],
  ["membre-creer", "creer"],
  ["membre-role", "changerRole"],
  ["membre-mot-de-passe", "changerMotDePasse"],
  ["membre-lien", "lienReinitialisation"],
  ["membre-renommer", "renommer"],
  ["membre-email", "changerEmail"],
  ["membre-bloquer", "bloquer"],
  ["membre-retirer", "retirer"],
];
const METHODE_DE = new Map(METHODES);

export function estActionMembres(action: unknown): boolean {
  return typeof action === "string" && METHODE_DE.has(action);
}

/** Le bloc `membres` du manifeste : seules les actions que le site sait faire. */
export function blocManifeste(site: SiteMembres): { version: number; actions: string[]; roles: Role[] } {
  return {
    version: VERSION_MEMBRES,
    actions: METHODES.filter(([, m]) => typeof site[m] === "function").map(([a]) => a),
    roles: site.roles,
  };
}

// ---------------------------------------------------------------------------
// Validation pure du corps reçu de Baikal.
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MOT_DE_PASSE_MIN = 8;
const MOT_DE_PASSE_MAX = 72; // limite de bcrypt : au-delà, la fin est ignorée
const NOM_MAX = 120;

export type Demande =
  | { action: "membres"; org_id: string | null }
  | ({ action: "membre-creer" } & Creation)
  | ({ action: "membre-role" } & Cible & { role: string })
  | ({ action: "membre-mot-de-passe" } & Cible & { mot_de_passe: string })
  | ({ action: "membre-lien" } & Cible)
  | ({ action: "membre-renommer" } & Cible & { nom: string })
  | ({ action: "membre-email" } & Cible & { email: string })
  | ({ action: "membre-bloquer" } & Cible & { bloque: boolean })
  | ({ action: "membre-retirer" } & Cible);

export type DemandeLue =
  | { ok: true; demande: Demande }
  | { ok: false; code: CodeErreur; detail: string };

const refus = (code: CodeErreur, detail: string): DemandeLue => ({ ok: false, code, detail });

function texte(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function lireDemande(corps: unknown, roles: Role[]): DemandeLue {
  if (!corps || typeof corps !== "object" || Array.isArray(corps)) {
    return refus("invalid_body", "objet JSON attendu");
  }
  const b = corps as Record<string, unknown>;
  const action = texte(b.action);
  if (!METHODE_DE.has(action)) return refus("action_inconnue", action);

  const auteur = texte(b.auteur).slice(0, 200) || null;

  if (action === "membres") {
    if (b.org_id == null || b.org_id === "") return { ok: true, demande: { action, org_id: null } };
    const orgId = texte(b.org_id);
    if (!UUID.test(orgId)) return refus("invalid_body", "org_id : uuid attendu");
    return { ok: true, demande: { action, org_id: orgId } };
  }

  // Champs partagés, validés à la demande.
  const email = (): string | null => {
    const e = texte(b.email).toLowerCase();
    return EMAIL.test(e) ? e : null;
  };
  const role = (): string | null => {
    const r = texte(b.role);
    return roles.some((x) => x.slug === r) ? r : null;
  };
  const motDePasse = (): string | "court" | null => {
    // Jamais de trim : un espace en bord de mot de passe est un caractère.
    if (typeof b.mot_de_passe !== "string") return null;
    if (b.mot_de_passe.length < MOT_DE_PASSE_MIN) return "court";
    if (b.mot_de_passe.length > MOT_DE_PASSE_MAX) return null;
    return b.mot_de_passe;
  };
  const nom = (): string | null => {
    const n = texte(b.nom);
    return n && n.length <= NOM_MAX ? n : null;
  };

  if (action === "membre-creer") {
    const e = email();
    if (!e) return refus("invalid_body", "email invalide");
    const mdp = motDePasse();
    if (mdp === "court") return refus("mot_de_passe_trop_court", `${MOT_DE_PASSE_MIN} caractères minimum`);
    if (!mdp) return refus("invalid_body", "mot_de_passe invalide");
    const orgId = texte(b.org_id);
    if (!UUID.test(orgId)) return refus("invalid_body", "org_id : uuid attendu");
    const r = role();
    if (!r) return refus("role_inconnu", texte(b.role));
    const n = texte(b.nom);
    if (n.length > NOM_MAX) return refus("invalid_body", "nom trop long");
    return {
      ok: true,
      demande: { action, email: e, mot_de_passe: mdp, nom: n || null, org_id: orgId, role: r, auteur },
    };
  }

  const id = texte(b.id);
  if (!UUID.test(id)) return refus("invalid_body", "id : uuid attendu");
  const cible: Cible = { id, auteur };

  switch (action) {
    case "membre-role": {
      const r = role();
      if (!r) return refus("role_inconnu", texte(b.role));
      return { ok: true, demande: { action, ...cible, role: r } };
    }
    case "membre-mot-de-passe": {
      const mdp = motDePasse();
      if (mdp === "court") return refus("mot_de_passe_trop_court", `${MOT_DE_PASSE_MIN} caractères minimum`);
      if (!mdp) return refus("invalid_body", "mot_de_passe invalide");
      return { ok: true, demande: { action, ...cible, mot_de_passe: mdp } };
    }
    case "membre-renommer": {
      const n = nom();
      if (!n) return refus("invalid_body", "nom requis");
      return { ok: true, demande: { action, ...cible, nom: n } };
    }
    case "membre-email": {
      const e = email();
      if (!e) return refus("invalid_body", "email invalide");
      return { ok: true, demande: { action, ...cible, email: e } };
    }
    case "membre-bloquer": {
      if (typeof b.bloque !== "boolean") return refus("invalid_body", "bloque : booléen attendu");
      return { ok: true, demande: { action, ...cible, bloque: b.bloque } };
    }
    case "membre-lien":
    case "membre-retirer":
      return { ok: true, demande: { action, ...cible } };
  }
  return refus("action_inconnue", action);
}

// ---------------------------------------------------------------------------
// Distribution.
// ---------------------------------------------------------------------------

export type Reponse = { statut: number; corps: unknown };

const erreur = (code: CodeErreur, detail?: string): Reponse => ({
  statut: CODES[code],
  corps: detail ? { error: code, detail } : { error: code },
});

/**
 * Valide, appelle la méthode du site, met en forme. Ne journalise rien : le
 * corps peut porter un mot de passe. `journal` reçoit l'action, la cible et
 * l'auteur, jamais le corps.
 */
export async function traiterMembres(
  corps: unknown,
  site: SiteMembres,
  journal: (ligne: string) => void = () => {},
): Promise<Reponse> {
  const lu = lireDemande(corps, site.roles);
  if (!lu.ok) return erreur(lu.code, lu.detail);
  const d = lu.demande;
  // Une action du contrat que ce site ne publie pas n'existe pas pour lui.
  if (typeof site[METHODE_DE.get(d.action)!] !== "function") return erreur("action_inconnue", d.action);

  try {
    switch (d.action) {
      case "membres":
        return { statut: 200, corps: await site.lister(d.org_id) };
      case "membre-creer": {
        const { action: _a, ...creation } = d;
        const membre = await site.creer!(creation);
        journal(`membre-creer org=${d.org_id} cible=${membre.id} par=${d.auteur ?? "?"}`);
        return { statut: 200, corps: { membre } };
      }
      case "membre-role": {
        const membre = await site.changerRole!({ id: d.id, auteur: d.auteur, role: d.role });
        journal(`membre-role cible=${d.id} role=${d.role} par=${d.auteur ?? "?"}`);
        return { statut: 200, corps: { membre } };
      }
      case "membre-mot-de-passe":
        await site.changerMotDePasse!({ id: d.id, auteur: d.auteur, mot_de_passe: d.mot_de_passe });
        journal(`membre-mot-de-passe cible=${d.id} par=${d.auteur ?? "?"}`);
        return { statut: 200, corps: { ok: true } };
      case "membre-lien": {
        const lien = await site.lienReinitialisation!({ id: d.id, auteur: d.auteur });
        journal(`membre-lien cible=${d.id} par=${d.auteur ?? "?"}`);
        return { statut: 200, corps: { lien } };
      }
      case "membre-renommer": {
        const membre = await site.renommer!({ id: d.id, auteur: d.auteur, nom: d.nom });
        journal(`membre-renommer cible=${d.id} par=${d.auteur ?? "?"}`);
        return { statut: 200, corps: { membre } };
      }
      case "membre-email": {
        const membre = await site.changerEmail!({ id: d.id, auteur: d.auteur, email: d.email });
        journal(`membre-email cible=${d.id} par=${d.auteur ?? "?"}`);
        return { statut: 200, corps: { membre } };
      }
      case "membre-bloquer": {
        const membre = await site.bloquer!({ id: d.id, auteur: d.auteur, bloque: d.bloque });
        journal(`membre-bloquer cible=${d.id} bloque=${d.bloque} par=${d.auteur ?? "?"}`);
        return { statut: 200, corps: { membre } };
      }
      case "membre-retirer":
        await site.retirer!({ id: d.id, auteur: d.auteur });
        journal(`membre-retirer cible=${d.id} par=${d.auteur ?? "?"}`);
        return { statut: 200, corps: { ok: true } };
    }
  } catch (e) {
    if (e instanceof ErreurMembres) return erreur(e.code, e.detail);
    // Le motif technique reste dans les journaux du site, sans le corps.
    journal(`${d.action} ECHEC ${e instanceof Error ? e.message : String(e)}`);
    return erreur("erreur_interne");
  }
}
