// supabase/functions/baikal-admin/membres.ts
// ============================================================================
// Contrat Membres v1 de Baikal : ce que Majord'home sait faire sur ses membres
// quand c'est la console d'administration qui le demande.
// Le relais (_shared/membres-relais-v1.ts, copie du contrat de référence de
// Baikal — ne pas l'éditer ici) valide et distribue ; ce fichier porte le métier.
//
// Publié : lister, créer, changer le mot de passe, bloquer. Le changement de
// rôle n'est PAS publié : il passe par les profils maison et la resynchronisation
// du rôle planning (permissions.service.updateMemberRole) — il reste dans
// Paramètres → Équipe tant qu'il n'a pas de voie serveur.
//
// La création suit les mêmes étapes que l'edge `create-user` (compte, profil,
// adhésion alignée), puis pose la ressource planning que le front pose
// d'habitude à l'ouverture de l'écran Équipe. Chaque écriture lit son { error }.
// ============================================================================
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type Creation,
  ErreurMembres,
  type Liste,
  type Membre,
  type SiteMembres,
} from "../_shared/membres-relais-v1.ts";

const APP = "majordhome";
// Blocage « définitif » : l'API n'a qu'une durée.
const BLOCAGE = "876000h";

// Rôles proposés à Baikal = rôles effectifs de l'app. Libellés et valeurs en
// base tenus en parité avec ROLE_LABELS / ROLE_DB_MAPPING de
// src/lib/permissions.js par membres.test.ts.
export const ROLES = [
  { slug: "org_admin", libelle: "Administrateur" },
  { slug: "team_leader", libelle: "Responsable" },
  { slug: "commercial", libelle: "Commercial" },
  { slug: "technicien", libelle: "Technicien" },
];

export const ROLES_DB: Record<
  string,
  { app_role: string; business_role: string | null; membership_role: string }
> = {
  org_admin: { app_role: "org_admin", business_role: null, membership_role: "org_admin" },
  team_leader: { app_role: "team_leader", business_role: null, membership_role: "team_leader" },
  commercial: { app_role: "user", business_role: "Commercial", membership_role: "member" },
  technicien: { app_role: "user", business_role: "Technicien", membership_role: "member" },
};

/** Lève avec le nom de l'étape : le relais le journalise, Baikal reçoit erreur_interne. */
function exiger(etape: string, error: { message: string } | null): void {
  if (error) throw new Error(`${etape}: ${error.message}`);
}

export function siteMembres(admin: SupabaseClient): SiteMembres {
  const lire = async (orgId: string | null, userId: string | null): Promise<Liste> => {
    const { data, error } = await admin.rpc("baikal_membres", { p_org_id: orgId, p_user_id: userId });
    exiger("baikal_membres", error);
    return data as Liste;
  };

  /** Le membre s'il appartient à une organisation de l'app, sinon membre_inconnu. */
  const cible = async (id: string): Promise<Membre> => {
    const { membres } = await lire(null, id);
    if (membres.length === 0) throw new ErreurMembres("membre_inconnu");
    return membres[0];
  };

  const lister = async (orgId: string | null): Promise<Liste> => {
    const liste = await lire(orgId, null);
    if (orgId && !liste.organisations.some((o) => o.id === orgId)) throw new ErreurMembres("org_inconnue");
    return liste;
  };

  const creer = async (d: Creation): Promise<Membre> => {
    const role = ROLES_DB[d.role];
    if (!role) throw new ErreurMembres("role_inconnu", d.role);

    const { data: org, error: orgError } = await admin
      .schema("core").from("organizations").select("id").eq("id", d.org_id).eq("app_id", APP).maybeSingle();
    exiger("organisation", orgError);
    if (!org) throw new ErreurMembres("org_inconnue");

    // 1. Compte. Une adresse déjà inscrite n'est reprise que si elle n'a AUCUN
    //    profil (compte orphelin d'un essai raté) : on ne rattache jamais le
    //    compte d'une autre organisation ou d'une app cohabitante, et on ne
    //    change jamais le mot de passe d'un compte qui a une existence.
    let userId: string;
    const { data: cree, error: createError } = await admin.auth.admin.createUser({
      email: d.email,
      password: d.mot_de_passe,
      email_confirm: true,
      user_metadata: { full_name: d.nom },
    });
    if (createError) {
      if (!/already|exists|registered/i.test(createError.message)) exiger("compte", createError);
      // RPC et non auth.admin.listUsers(), en panne sur cette instance (jetons NULL).
      const { data: existant, error: lookupError } = await admin.rpc("auth_user_id_by_email", { p_email: d.email });
      exiger("compte existant", lookupError);
      if (!existant) throw new Error(`compte: ${createError.message}`);
      const { data: profil, error: profilError } = await admin
        .schema("core").from("profiles").select("id").eq("id", existant).maybeSingle();
      exiger("profil existant", profilError);
      if (profil) throw new ErreurMembres("deja_membre");
      const { error: mdpError } = await admin.auth.admin.updateUserById(existant as string, {
        password: d.mot_de_passe,
        user_metadata: { full_name: d.nom },
      });
      exiger("compte repris", mdpError);
      userId = existant as string;
    } else {
      userId = cree.user.id;
    }

    // 2. Profil : aucun trigger auth.users ne le crée. Le trigger
    //    core.sync_profile_org_membership pose l'adhésion à partir de org_id.
    const { error: profilError } = await admin.schema("core").from("profiles").upsert({
      id: userId,
      email: d.email,
      full_name: d.nom,
      app_role: role.app_role,
      business_role: role.business_role,
      org_id: d.org_id,
      app_id: APP,
    }, { onConflict: "id" });
    exiger("profil", profilError);

    // 3. Adhésion alignée sur le rôle demandé (le trigger recopie app_role tel quel).
    const { data: adhesion, error: lectureError } = await admin
      .schema("core").from("organization_members").select("id")
      .eq("org_id", d.org_id).eq("user_id", userId).maybeSingle();
    exiger("adhésion", lectureError);
    const { error: adhesionError } = adhesion
      ? await admin.schema("core").from("organization_members")
        .update({ role: role.membership_role, status: "active" }).eq("id", adhesion.id)
      : await admin.schema("core").from("organization_members")
        .insert({
          org_id: d.org_id,
          user_id: userId,
          role: role.membership_role,
          status: "active",
          invited_at: new Date().toISOString(),
        });
    exiger("adhésion", adhesionError);

    // 4. Ressource planning. Une organisation sans ligne majordhome.organizations
    //    n'a pas de planning : la RPC le dit (P0002 « org majordhome introuvable »)
    //    et il n'y a alors rien à poser. Le schéma `majordhome` n'est pas exposé
    //    à l'API : pas de lecture directe possible depuis ici (vécu 2026-11-21,
    //    « Invalid schema: majordhome » après compte, profil et adhésion créés).
    const { error: planningError } = await admin.rpc("team_member_ensure_for_user", {
      p_core_org_id: d.org_id,
      p_user_id: userId,
      p_color: null,
    });
    if (planningError && !/org majordhome introuvable/i.test(planningError.message)) {
      exiger("ressource planning", planningError);
    }

    return await cible(userId);
  };

  const changerMotDePasse = async (d: { id: string; mot_de_passe: string }): Promise<void> => {
    await cible(d.id);
    const { error } = await admin.auth.admin.updateUserById(d.id, { password: d.mot_de_passe });
    exiger("mot de passe", error);
  };

  const bloquer = async (d: { id: string; bloque: boolean }): Promise<Membre> => {
    await cible(d.id);
    const { error } = await admin.auth.admin.updateUserById(d.id, {
      ban_duration: d.bloque ? BLOCAGE : "none",
    });
    exiger("blocage", error);
    return await cible(d.id);
  };

  return { roles: ROLES, lister, creer, changerMotDePasse, bloquer };
}
