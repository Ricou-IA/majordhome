// deno test supabase/functions/baikal-admin/membres.test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { EFFECTIVE_ROLES, ROLE_DB_MAPPING, ROLE_LABELS } from "../../../src/lib/permissions.js";
import { blocManifeste, ErreurMembres } from "../_shared/membres-relais-v1.ts";
import { ROLES, ROLES_DB, siteMembres } from "./membres.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const MEMBRE = {
  id: ID,
  email: "membre@exemple.test",
  nom: "Membre Exemple",
  org_id: ORG,
  role: "technicien",
  cree_le: "2026-11-20T10:00:00Z",
  derniere_connexion: null,
  bloque: false,
};
const DEMANDE = {
  email: "membre@exemple.test",
  mot_de_passe: "motdepasse",
  nom: "Membre Exemple",
  org_id: ORG,
  role: "commercial",
  auteur: "admin@exemple.test",
};

// ---- Parité avec le front ---------------------------------------------------

Deno.test("les rôles publiés sont ceux de l'app, libellés compris", () => {
  assertEquals(ROLES.map((r) => r.slug), EFFECTIVE_ROLES);
  for (const r of ROLES) assertEquals(r.libelle, (ROLE_LABELS as Record<string, string>)[r.slug]);
});

Deno.test("les valeurs en base d'un rôle sont celles du front", () => {
  assertEquals(ROLES_DB, ROLE_DB_MAPPING);
});

// ---- Faux client : une table de réponses, un journal d'appels ----------------

type Reponse = { data?: unknown; error?: { message: string } | null };
function faux(reponses: Record<string, Reponse | Reponse[]>) {
  const appels: Array<{ cle: string; args?: unknown }> = [];
  const prendre = (cle: string, args?: unknown) => {
    appels.push({ cle, args });
    const r = reponses[cle];
    const une = Array.isArray(r) ? r.shift() : r;
    return Promise.resolve({ data: null, error: null, ...(une ?? {}) });
  };
  const table = (schema: string, nom: string) => {
    const base = `${schema}.${nom}`;
    const lecture = (cle: string) => {
      const q: Record<string, unknown> = {};
      q.eq = () => q;
      q.maybeSingle = () => prendre(cle);
      q.then = (ok: (v: unknown) => unknown) => prendre(cle).then(ok);
      return q;
    };
    return {
      select: () => lecture(`${base}.select`),
      upsert: (ligne: unknown) => prendre(`${base}.upsert`, ligne),
      insert: (ligne: unknown) => prendre(`${base}.insert`, ligne),
      update: (ligne: unknown) => {
        appels.push({ cle: `${base}.update.valeurs`, args: ligne });
        return lecture(`${base}.update`);
      },
    };
  };
  const client = {
    rpc: (fn: string, args: unknown) => prendre(`rpc.${fn}`, args),
    schema: (schema: string) => ({ from: (nom: string) => table(schema, nom) }),
    auth: {
      admin: {
        createUser: (args: unknown) => prendre("auth.createUser", args),
        updateUserById: (id: string, args: unknown) => prendre("auth.updateUserById", { id, ...(args as object) }),
      },
    },
  } as unknown as SupabaseClient;
  return { client, appels, cles: () => appels.map((a) => a.cle) };
}

const LISTE = { organisations: [{ id: ORG, nom: "Org" }], membres: [MEMBRE] };

// ---- Manifeste ----------------------------------------------------------------

Deno.test("publié : lister, créer, mot de passe, bloquer — pas le rôle", () => {
  assertEquals(blocManifeste(siteMembres(faux({}).client)).actions, [
    "membres",
    "membre-creer",
    "membre-mot-de-passe",
    "membre-bloquer",
  ]);
});

// ---- Liste --------------------------------------------------------------------

Deno.test("liste d'une organisation inconnue de l'app : org_inconnue", async () => {
  const f = faux({ "rpc.baikal_membres": { data: { organisations: [], membres: [] } } });
  await assertRejects(() => siteMembres(f.client).lister(ORG), ErreurMembres, "org_inconnue");
});

Deno.test("liste : rendue telle que la base la donne", async () => {
  const f = faux({ "rpc.baikal_membres": { data: LISTE } });
  assertEquals(await siteMembres(f.client).lister(null), LISTE);
  assertEquals(f.appels[0].args, { p_org_id: null, p_user_id: null });
});

// ---- Création -----------------------------------------------------------------

Deno.test("création complète : compte, profil, adhésion alignée, planning", async () => {
  const f = faux({
    "core.organizations.select": { data: { id: ORG } },
    "auth.createUser": { data: { user: { id: ID } } },
    "core.organization_members.select": { data: { id: "adhesion-1" } },
    "majordhome.organizations.select": { data: { id: "org-metier" } },
    "rpc.team_member_ensure_for_user": { data: "tm-1" },
    "rpc.baikal_membres": { data: LISTE },
  });
  assertEquals(await siteMembres(f.client).creer!(DEMANDE), MEMBRE);
  assertEquals(f.cles(), [
    "core.organizations.select",
    "auth.createUser",
    "core.profiles.upsert",
    "core.organization_members.select",
    "core.organization_members.update.valeurs",
    "core.organization_members.update",
    "majordhome.organizations.select",
    "rpc.team_member_ensure_for_user",
    "rpc.baikal_membres",
  ]);
  const profil = f.appels.find((a) => a.cle === "core.profiles.upsert")!.args;
  assertEquals(profil, {
    id: ID,
    email: "membre@exemple.test",
    full_name: "Membre Exemple",
    app_role: "user",
    business_role: "Commercial",
    org_id: ORG,
    app_id: "majordhome",
  });
  assertEquals(f.appels.find((a) => a.cle === "core.organization_members.update.valeurs")!.args, {
    role: "member",
    status: "active",
  });
});

Deno.test("organisation sans planning : pas de ressource planning", async () => {
  const f = faux({
    "core.organizations.select": { data: { id: ORG } },
    "auth.createUser": { data: { user: { id: ID } } },
    "rpc.baikal_membres": { data: LISTE },
  });
  await siteMembres(f.client).creer!(DEMANDE);
  assertEquals(f.cles().includes("core.organization_members.insert"), true);
  assertEquals(f.cles().includes("rpc.team_member_ensure_for_user"), false);
});

Deno.test("organisation d'une autre app : org_inconnue, rien n'est créé", async () => {
  const f = faux({ "core.organizations.select": { data: null } });
  await assertRejects(() => siteMembres(f.client).creer!(DEMANDE), ErreurMembres, "org_inconnue");
  assertEquals(f.cles(), ["core.organizations.select"]);
});

Deno.test("adresse déjà inscrite avec un profil : deja_membre, mot de passe intact", async () => {
  const f = faux({
    "core.organizations.select": { data: { id: ORG } },
    "auth.createUser": { error: { message: "A user with this email address has already been registered" } },
    "rpc.auth_user_id_by_email": { data: ID },
    "core.profiles.select": { data: { id: ID } },
  });
  await assertRejects(() => siteMembres(f.client).creer!(DEMANDE), ErreurMembres, "deja_membre");
  assertEquals(f.cles().includes("auth.updateUserById"), false);
  assertEquals(f.cles().includes("core.profiles.upsert"), false);
});

Deno.test("compte orphelin sans profil : repris, mot de passe posé", async () => {
  const f = faux({
    "core.organizations.select": { data: { id: ORG } },
    "auth.createUser": { error: { message: "already registered" } },
    "rpc.auth_user_id_by_email": { data: ID },
    "core.profiles.select": { data: null },
    "rpc.baikal_membres": { data: LISTE },
  });
  assertEquals(await siteMembres(f.client).creer!(DEMANDE), MEMBRE);
  assertEquals(f.appels.find((a) => a.cle === "auth.updateUserById")!.args, {
    id: ID,
    password: "motdepasse",
    user_metadata: { full_name: "Membre Exemple" },
  });
});

Deno.test("une écriture en échec arrête tout, avec le nom de l'étape", async () => {
  const f = faux({
    "core.organizations.select": { data: { id: ORG } },
    "auth.createUser": { data: { user: { id: ID } } },
    "core.profiles.upsert": { error: { message: "violates check constraint" } },
  });
  await assertRejects(() => siteMembres(f.client).creer!(DEMANDE), Error, "profil: violates check constraint");
  assertEquals(f.cles().includes("core.organization_members.select"), false);
});

// ---- Gestes sur un membre -------------------------------------------------------

Deno.test("cible hors des organisations de l'app : membre_inconnu, aucune écriture", async () => {
  const f = faux({ "rpc.baikal_membres": { data: { organisations: [], membres: [] } } });
  const site = siteMembres(f.client);
  await assertRejects(() => site.changerMotDePasse!({ id: ID, auteur: null, mot_de_passe: "motdepasse" }), ErreurMembres, "membre_inconnu");
  await assertRejects(() => site.bloquer!({ id: ID, auteur: null, bloque: true }), ErreurMembres, "membre_inconnu");
  assertEquals(f.cles().includes("auth.updateUserById"), false);
});

Deno.test("blocage et déblocage : durée longue, puis none ; état relu en base", async () => {
  const f = faux({
    "rpc.baikal_membres": [
      { data: LISTE },
      { data: { ...LISTE, membres: [{ ...MEMBRE, bloque: true }] } },
      { data: LISTE },
      { data: LISTE },
    ],
  });
  const site = siteMembres(f.client);
  assertEquals((await site.bloquer!({ id: ID, auteur: null, bloque: true })).bloque, true);
  await site.bloquer!({ id: ID, auteur: null, bloque: false });
  assertEquals(
    f.appels.filter((a) => a.cle === "auth.updateUserById").map((a) => a.args),
    [{ id: ID, ban_duration: "876000h" }, { id: ID, ban_duration: "none" }],
  );
});

Deno.test("mot de passe : posé sur un membre de l'app", async () => {
  const f = faux({ "rpc.baikal_membres": { data: LISTE } });
  await siteMembres(f.client).changerMotDePasse!({ id: ID, auteur: null, mot_de_passe: "motdepasse" });
  assertEquals(f.appels.at(-1), { cle: "auth.updateUserById", args: { id: ID, password: "motdepasse" } });
});
