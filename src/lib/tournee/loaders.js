// src/lib/tournee/loaders.js
// ============================================================================
// Chargement des données du moteur de tournées — version INJECTABLE.
// Le client supabase est passé en paramètre : le MÊME code charge les journées
// dans le navigateur (tournees.service.js::getJourneesHorizon) et dans l'edge
// slots-propose (copie supabase/functions/_shared/tournee/, synchronisée et
// testée). Aucun import d'alias Vite. Testé : node --test scripts/tournee/loaders.test.mjs
//
// ⚠️ ASYMÉTRIE D'ORG : `coreOrgId` (core.organizations) porte contracts /
// clients / pricing_equipment_types / leads ; `mdhOrgId` (majordhome.organizations)
// porte team_members / appointments. L'appelant résout `mdhOrgId`
// (getMajordhomeOrgId côté app, vue majordhome_organizations côté edge).
// ============================================================================
import { dureeContrat, construireFallbacks } from './duree.js';

const hhmmEnMinutes = (s) => {
  const [h, m] = String(s || '08:00').split(':').map(Number);
  return h * 60 + (m || 0);
};

/**
 * @typedef {object} Journee
 * @property {string} date  YYYY-MM-DD
 * @property {string} technicienId
 * @property {string} technicienNom
 * @property {string|null} couleur
 * @property {{ debut: number, fin: number }} amplitude  minutes depuis minuit
 * @property {number} budgetMinutes
 * @property {Array<object>} rdvs  RDV du jour pour ce technicien (colonnes
 *   majordhome_appointments + `lat`/`lng` résolus client → lead → null)
 * @property {number} chargeMinutes  somme des `duration_minutes`, TOUS les RDV
 * @property {boolean} estAmorcee  au moins un RDV de type 'maintenance' ce jour-là
 * @property {string[]} specialties  compétences du technicien (catégories d'équipement)
 */

/**
 * Journées de l'horizon par technicien inclus dans l'optimisation
 * (`include_in_routing = true`, actif). Charge et annote, ne filtre PAS
 * horizon/amorçage (à l'appelant : onglet Tournées ou proposerPourContrat).
 *
 * @param {object} p
 * @param {object} p.client      client supabase-js
 * @param {string} p.coreOrgId   org CORE (clients/leads)
 * @param {string} p.mdhOrgId    org majordhome (team_members/appointments)
 * @param {number} [p.joursApres=45]
 * @param {Date} [p.maintenant=new Date()]
 * @param {{ error: Function }} [p.logger=console]
 * @returns {Promise<{ data: Journee[], techniciens: Array<{ id, nom, specialties: string[], couleur }>, error: Error|null }>}
 */
export async function chargerJournees({
  client, coreOrgId, mdhOrgId, joursApres = 45, maintenant = new Date(), logger: log = console,
}) {
  try {
  const orgId = mdhOrgId;
  const debut = new Date(maintenant);
  const fin = new Date(maintenant);
  fin.setDate(fin.getDate() + joursApres);
  const iso = (d) => d.toISOString().slice(0, 10);

  const [{ data: membres, error: mErr }, { data: rdvs, error: rErr }] = await Promise.all([
    // I5 (revue finale) — `is_active` manquait ici alors que getTeamMembers
    // (appointments.service.js) le filtre : sans lui, un technicien parti
    // continue de recevoir des propositions de tournée.
    client.from('majordhome_team_members')
      .select('id, display_name, calendar_color, default_availability, daily_work_minutes, include_in_routing, specialties')
      .eq('org_id', orgId).eq('role', 'technician').eq('include_in_routing', true).eq('is_active', true),
    client.from('majordhome_appointments')
      // ⚠️ `lead_id` est INDISPENSABLE ici : la résolution de coordonnées ci-dessous
      // en dépend (RDV rattaché à un lead, cf. bloc `leadIds`). Sans lui dans le
      // SELECT, `r.lead_id` vaut `undefined`, `leadIds` reste vide et TOUT le repli
      // lead est du code mort — silencieusement, puisque le repli suivant (siège)
      // fournit quand même une position plausible. Vécu : livré ainsi, jamais vu.
      .select('id, client_id, lead_id, scheduled_date, scheduled_start, duration_minutes, appointment_type, client_name, address, city, postal_code, time_flex_minutes, hour_confirmed_at')
      .eq('org_id', orgId).gte('scheduled_date', iso(debut)).lte('scheduled_date', iso(fin))
      .not('status', 'in', '(cancelled,no_show)'),
  ]);
  if (mErr) return { data: [], techniciens: [], error: mErr };
  if (rErr) return { data: [], techniciens: [], error: rErr };

  // Amendement 1 — les RDV existants DOIVENT porter leurs coordonnées :
  // sans elles, `arretsExistants` (proposerPourJournee) est TOUJOURS vide
  // et les candidats sont classés par distance au DÉPÔT au lieu de
  // distance à la TOURNÉE — le défaut central que ce module corrige.
  const clientIds = [...new Set((rdvs || []).map((r) => r.client_id).filter(Boolean))];
  const { data: clientsCoord, error: ccErr } = clientIds.length
    ? await client.from('majordhome_clients')
        .select('id, latitude, longitude').eq('org_id', coreOrgId).in('id', clientIds)
    : { data: [], error: null };
  if (ccErr) return { data: [], techniciens: [], error: ccErr };
  const coordByClientId = new Map((clientsCoord || []).map((c) => [c.id, c]));

  // Tous les RDV n'ont pas de client : une installation est rattachee a un
  // LEAD (10 RDV sur 30 jours en prod, dont l'installation HACK du 04/09).
  // On tente donc aussi le lead. Note : en pratique ces leads ne sont pas
  // encore geocodes, d'ou le troisieme niveau (siege) applique plus loin,
  // au moment ou le depot est connu.
  const leadIds = [...new Set((rdvs || [])
    .filter((r) => !r.client_id && r.lead_id).map((r) => r.lead_id))];
  const { data: leadsCoord, error: lcErr } = leadIds.length
    ? await client.from('majordhome_leads')
        .select('id, latitude, longitude').eq('org_id', coreOrgId).in('id', leadIds)
    : { data: [], error: null };
  if (lcErr) return { data: [], techniciens: [], error: lcErr };
  const coordByLeadId = new Map((leadsCoord || []).map((l) => [l.id, l]));
  // Un RDV sans coordonnee (ni client ni lead geocode) garde lat/lng null ici :
  // le fallback siege est applique dans proposerPourJournee, seul endroit ou le
  // depot est connu. Il n'est JAMAIS ecarte pour autant (il bloque son creneau).
  // Ancien commentaire conserve pour memoire :
  // Un RDV sans coordonnée reste compté dans chargeMinutes (le technicien y
  // passe du temps) mais sera exclu de arretsExistants côté proposerPourJournee
  // (r.lat/r.lng null) : il ne peut pas participer au séquencement géographique.
  const rdvsAvecCoords = (rdvs || []).map((r) => {
    const co = (r.client_id ? coordByClientId.get(r.client_id) : null)
      || (r.lead_id ? coordByLeadId.get(r.lead_id) : null);
    return { ...r, lat: co?.latitude ?? null, lng: co?.longitude ?? null };
  });

  const ids = rdvsAvecCoords.map((r) => r.id);
  const { data: liens, error: liensErr } = ids.length
    ? await client.from('majordhome_appointment_technicians')
        .select('appointment_id, technician_id').in('appointment_id', ids)
    : { data: [], error: null };
  if (liensErr) return { data: [], techniciens: [], error: liensErr };
  const techsParRdv = new Map();
  for (const l of liens || []) {
    if (!techsParRdv.has(l.appointment_id)) techsParRdv.set(l.appointment_id, []);
    techsParRdv.get(l.appointment_id).push(l.technician_id);
  }

  const JOURS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const journees = [];
  for (let i = 0; i <= joursApres; i += 1) {
    const d = new Date(maintenant);
    d.setDate(d.getDate() + i);
    const date = iso(d);
    const jour = JOURS[d.getDay()];
    for (const m of membres || []) {
      const dispo = m.default_availability?.[jour];
      // I6 (revue finale) — deux lectures divergentes du même champ
      // coexistaient : ici, un jour SANS `active` était OFF ; dans
      // `scheduleConflicts.js::memberWorkingHoursForDate` (plus ancien),
      // un jour SANS `active` est ON (seul `active === false` coupe).
      // Alignement sur la lecture de référence (scheduleConflicts.js) —
      // la plus ancienne et la plus permissive. Sans effet sur les
      // données Mayer actuelles (`active` toujours renseigné en base),
      // mais évite une divergence future entre les deux lectures.
      if (!dispo || dispo.active === false) continue;
      const duJour = rdvsAvecCoords.filter(
        (r) => r.scheduled_date === date && (techsParRdv.get(r.id) || []).includes(m.id),
      );
      journees.push({
        date,
        technicienId: m.id,
        technicienNom: m.display_name,
        couleur: m.calendar_color,
        amplitude: { debut: hhmmEnMinutes(dispo.start), fin: hhmmEnMinutes(dispo.end) },
        budgetMinutes: m.daily_work_minutes || 480,
        rdvs: duJour,
        chargeMinutes: duJour.reduce((s, r) => s + (r.duration_minutes || 60), 0),
        estAmorcee: duJour.some((r) => r.appointment_type === 'maintenance'),
        specialties: m.specialties || [],
      });
    }
  }
  const techniciens = (membres || []).map((m) => ({
    id: m.id, nom: m.display_name, specialties: m.specialties || [], couleur: m.calendar_color ?? null,
  }));
  return { data: journees, techniciens, error: null };
  } catch (error) {
    log.error('[tournees] chargerJournees', error);
    return { data: [], techniciens: [], error };
  }
}

/**
 * Le contrat à proposer : durée barémée (même mécanique que getContratsDus,
 * fallbacks calculés sur les seuls équipements du contrat — l'onglet Tournées,
 * lui, les calcule sur le parc entier ; écart accepté, à unifier si un test
 * terrain montre un décalage de durée), catégories d'équipement (compétence
 * requise) et coordonnées du client.
 *
 * @param {{ client: object, coreOrgId: string, contractId: string }} p
 * @returns {Promise<{ data: { id, clientId, clientName, ville, lat, lng, dureeMinutes, categories: string[], typesNonRenseignes: number, sansEquipement: boolean }|null, error: Error|null }>}
 */
export async function chargerContrat({ client, coreOrgId, contractId }) {
  const [{ data: contrat, error: cErr }, { data: types, error: tErr }] = await Promise.all([
    client.from('majordhome_contracts')
      .select('id, client_id, client_name, client_city, client_postal_code, start_date')
      .eq('org_id', coreOrgId).eq('id', contractId).maybeSingle(),
    client.from('majordhome_pricing_equipment_types')
      .select('id, code, category, duration_base_minutes, duration_per_extra_unit_minutes, included_units, unfavorable_months')
      .eq('org_id', coreOrgId),
  ]);
  if (cErr) return { data: null, error: cErr };
  if (tErr) return { data: null, error: tErr };
  if (!contrat) return { data: null, error: new Error('contrat_introuvable') };

  const [{ data: clients, error: clErr }, { data: liens, error: lErr }] = await Promise.all([
    contrat.client_id
      ? client.from('majordhome_clients').select('id, latitude, longitude').eq('org_id', coreOrgId).in('id', [contrat.client_id])
      : Promise.resolve({ data: [], error: null }),
    client.from('majordhome_contract_equipments').select('contract_id, equipment_id').in('contract_id', [contractId]),
  ]);
  if (clErr) return { data: null, error: clErr };
  if (lErr) return { data: null, error: lErr };

  const equipIds = [...new Set((liens || []).map((l) => l.equipment_id))];
  const { data: equipements, error: eqErr } = equipIds.length
    ? await client.from('majordhome_equipments').select('id, category, unit_count, equipment_type_id').in('id', equipIds)
    : { data: [], error: null };
  if (eqErr) return { data: null, error: eqErr };

  const typesById = new Map((types || []).map((t) => [t.id, t]));
  const DUREE_DEFAUT = 90;
  const fallbacks = construireFallbacks(equipements || [], typesById, DUREE_DEFAUT);
  const co = (clients || [])[0];
  // Un contrat sans équipement rattaché n'a pas de durée calculable : on ne
  // pose JAMAIS un RDV de 0 minute, on prend la durée par défaut et on le dit.
  const sansEquipement = (equipements || []).length === 0;
  const duree = sansEquipement ? DUREE_DEFAUT : dureeContrat(equipements, typesById, fallbacks);
  return {
    data: {
      id: contrat.id,
      clientId: contrat.client_id,
      clientName: contrat.client_name,
      ville: contrat.client_city,
      lat: co?.latitude ?? null,
      lng: co?.longitude ?? null,
      dureeMinutes: Math.max(duree, 15),
      categories: [...new Set((equipements || []).map((e) => e.category).filter(Boolean))],
      typesNonRenseignes: (equipements || []).filter((e) => !e.equipment_type_id).length,
      sansEquipement,
    },
    error: null,
  };
}
