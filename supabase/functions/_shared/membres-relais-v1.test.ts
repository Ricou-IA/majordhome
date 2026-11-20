import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  blocManifeste,
  ErreurMembres,
  estActionMembres,
  lireDemande,
  type Membre,
  type SiteMembres,
  traiterMembres,
} from "./membres-relais-v1.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const ROLES = [
  { slug: "org_admin", libelle: "Administrateur" },
  { slug: "technicien", libelle: "Technicien" },
];
const membre = (sup: Partial<Membre> = {}): Membre => ({
  id: ID,
  email: "membre@exemple.test",
  nom: "Membre Exemple",
  org_id: ORG,
  role: "technicien",
  cree_le: "2026-11-20T10:00:00Z",
  derniere_connexion: null,
  bloque: false,
  ...sup,
});
const creation = (sup: Record<string, unknown> = {}) => ({
  action: "membre-creer",
  email: " Membre@Exemple.TEST ",
  mot_de_passe: "motdepasse",
  nom: "Membre Exemple",
  org_id: ORG,
  role: "technicien",
  auteur: "admin@exemple.test",
  ...sup,
});
const refus = (corps: unknown) => {
  const lu = lireDemande(corps, ROLES);
  return lu.ok ? "accepté" : lu.code;
};

// ---- Manifeste ------------------------------------------------------------

Deno.test("le manifeste ne publie que ce que le site sait faire", () => {
  const site: SiteMembres = {
    roles: ROLES,
    lister: () => Promise.resolve({ organisations: [], membres: [] }),
    creer: () => Promise.resolve(membre()),
    bloquer: () => Promise.resolve(membre()),
  };
  assertEquals(blocManifeste(site), {
    version: 1,
    actions: ["membres", "membre-creer", "membre-bloquer"],
    roles: ROLES,
  });
});

Deno.test("les actions du contrat sont reconnues, les autres non", () => {
  assertEquals(estActionMembres("membres"), true);
  assertEquals(estActionMembres("membre-retirer"), true);
  assertEquals(estActionMembres("modules"), false);
  assertEquals(estActionMembres(undefined), false);
});

// ---- Validation -----------------------------------------------------------

Deno.test("création : adresse normalisée, mot de passe intact", () => {
  assertEquals(lireDemande(creation({ mot_de_passe: " avec espaces " }), ROLES), {
    ok: true,
    demande: {
      action: "membre-creer",
      email: "membre@exemple.test",
      mot_de_passe: " avec espaces ",
      nom: "Membre Exemple",
      org_id: ORG,
      role: "technicien",
      auteur: "admin@exemple.test",
    },
  });
});

Deno.test("création : nom et auteur facultatifs", () => {
  const lu = lireDemande(creation({ nom: "  ", auteur: undefined }), ROLES);
  assertEquals(lu.ok && lu.demande.action === "membre-creer" && [lu.demande.nom, lu.demande.auteur], [null, null]);
});

Deno.test("création : chaque refus porte son code", () => {
  assertEquals(refus(creation({ email: "pas-une-adresse" })), "invalid_body");
  assertEquals(refus(creation({ mot_de_passe: "court" })), "mot_de_passe_trop_court");
  assertEquals(refus(creation({ mot_de_passe: "x".repeat(73) })), "invalid_body");
  assertEquals(refus(creation({ mot_de_passe: 12345678 })), "invalid_body");
  assertEquals(refus(creation({ org_id: "pas-un-uuid" })), "invalid_body");
  assertEquals(refus(creation({ role: "super_admin" })), "role_inconnu");
  assertEquals(refus(creation({ role: undefined })), "role_inconnu");
});

Deno.test("corps mal formé ou action hors contrat", () => {
  assertEquals(refus(null), "invalid_body");
  assertEquals(refus([]), "invalid_body");
  assertEquals(refus("membres"), "invalid_body");
  assertEquals(refus({ action: "modules" }), "action_inconnue");
  assertEquals(refus({}), "action_inconnue");
});

Deno.test("liste : toutes les organisations, ou une seule", () => {
  assertEquals(lireDemande({ action: "membres" }, ROLES), { ok: true, demande: { action: "membres", org_id: null } });
  assertEquals(lireDemande({ action: "membres", org_id: ORG }, ROLES), {
    ok: true,
    demande: { action: "membres", org_id: ORG },
  });
  assertEquals(refus({ action: "membres", org_id: "x" }), "invalid_body");
});

Deno.test("gestes sur un membre : la cible est un uuid", () => {
  assertEquals(refus({ action: "membre-bloquer", id: "x", bloque: true }), "invalid_body");
  assertEquals(refus({ action: "membre-bloquer", id: ID, bloque: "oui" }), "invalid_body");
  assertEquals(refus({ action: "membre-bloquer", id: ID, bloque: false }), "accepté");
  assertEquals(refus({ action: "membre-mot-de-passe", id: ID, mot_de_passe: "court" }), "mot_de_passe_trop_court");
  assertEquals(refus({ action: "membre-role", id: ID, role: "inconnu" }), "role_inconnu");
  assertEquals(refus({ action: "membre-renommer", id: ID, nom: " " }), "invalid_body");
  assertEquals(refus({ action: "membre-email", id: ID, email: "non" }), "invalid_body");
  assertEquals(refus({ action: "membre-lien", id: ID }), "accepté");
  assertEquals(refus({ action: "membre-retirer", id: ID }), "accepté");
});

// ---- Distribution ---------------------------------------------------------

function site(sup: Partial<SiteMembres> = {}): SiteMembres {
  return {
    roles: ROLES,
    lister: (orgId) =>
      Promise.resolve({ organisations: [{ id: ORG, nom: "Org" }], membres: orgId ? [membre()] : [] }),
    ...sup,
  };
}

Deno.test("liste rendue telle que le site la donne", async () => {
  assertEquals(await traiterMembres({ action: "membres", org_id: ORG }, site()), {
    statut: 200,
    corps: { organisations: [{ id: ORG, nom: "Org" }], membres: [membre()] },
  });
});

Deno.test("création : le site reçoit la demande validée, sans le champ action", async () => {
  let recu: unknown = null;
  const lignes: string[] = [];
  const r = await traiterMembres(
    creation(),
    site({
      creer: (d) => {
        recu = d;
        return Promise.resolve(membre());
      },
    }),
    (l) => lignes.push(l),
  );
  assertEquals(r, { statut: 200, corps: { membre: membre() } });
  assertEquals(recu, {
    email: "membre@exemple.test",
    mot_de_passe: "motdepasse",
    nom: "Membre Exemple",
    org_id: ORG,
    role: "technicien",
    auteur: "admin@exemple.test",
  });
  assertEquals(lignes, [`membre-creer org=${ORG} cible=${ID} par=admin@exemple.test`]);
});

Deno.test("le mot de passe n'entre jamais dans le journal", async () => {
  const lignes: string[] = [];
  const secret = "secret-a-ne-pas-ecrire";
  await traiterMembres(creation({ mot_de_passe: secret }), site({ creer: () => Promise.resolve(membre()) }), (l) => lignes.push(l));
  await traiterMembres(
    { action: "membre-mot-de-passe", id: ID, mot_de_passe: secret },
    site({ changerMotDePasse: () => Promise.reject(new Error("panne")) }),
    (l) => lignes.push(l),
  );
  assertEquals(lignes.length, 2);
  assertEquals(lignes.some((l) => l.includes(secret)), false);
});

Deno.test("une action que le site ne publie pas n'existe pas", async () => {
  assertEquals(await traiterMembres({ action: "membre-retirer", id: ID }, site()), {
    statut: 400,
    corps: { error: "action_inconnue", detail: "membre-retirer" },
  });
});

Deno.test("refus de validation : statut et code du contrat", async () => {
  assertEquals(await traiterMembres(creation({ mot_de_passe: "court" }), site({ creer: () => Promise.resolve(membre()) })), {
    statut: 400,
    corps: { error: "mot_de_passe_trop_court", detail: "8 caractères minimum" },
  });
});

Deno.test("erreur nommée du site : son code et son statut", async () => {
  const s = site({
    creer: () => Promise.reject(new ErreurMembres("deja_membre")),
    bloquer: () => Promise.reject(new ErreurMembres("membre_inconnu")),
  });
  assertEquals(await traiterMembres(creation(), s), { statut: 409, corps: { error: "deja_membre" } });
  assertEquals(await traiterMembres({ action: "membre-bloquer", id: ID, bloque: true }, s), {
    statut: 404,
    corps: { error: "membre_inconnu" },
  });
});

Deno.test("panne du site : 500 sans motif technique dans la réponse", async () => {
  const lignes: string[] = [];
  const r = await traiterMembres(
    creation(),
    site({ creer: () => Promise.reject(new Error("connexion refusée à db.interne")) }),
    (l) => lignes.push(l),
  );
  assertEquals(r, { statut: 500, corps: { error: "erreur_interne" } });
  assertEquals(lignes, ["membre-creer ECHEC connexion refusée à db.interne"]);
});

Deno.test("gestes simples : réponses du contrat", async () => {
  const s = site({
    changerMotDePasse: () => Promise.resolve(),
    lienReinitialisation: () => Promise.resolve("https://site.test/reinitialiser#jeton"),
    bloquer: (d) => Promise.resolve(membre({ bloque: d.bloque })),
    retirer: () => Promise.resolve(),
  });
  assertEquals(await traiterMembres({ action: "membre-mot-de-passe", id: ID, mot_de_passe: "motdepasse" }, s), {
    statut: 200,
    corps: { ok: true },
  });
  assertEquals(await traiterMembres({ action: "membre-lien", id: ID }, s), {
    statut: 200,
    corps: { lien: "https://site.test/reinitialiser#jeton" },
  });
  assertEquals(await traiterMembres({ action: "membre-bloquer", id: ID, bloque: true }, s), {
    statut: 200,
    corps: { membre: membre({ bloque: true }) },
  });
  assertEquals(await traiterMembres({ action: "membre-retirer", id: ID }, s), { statut: 200, corps: { ok: true } });
});
