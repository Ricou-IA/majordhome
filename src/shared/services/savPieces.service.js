import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

/**
 * Pièces identifiées sur une carte SAV — vue `majordhome_sav_part_selections` (miroir updatable).
 * `photo` = sortie de `photoPiece` (src/lib/catalogue/piecesIdentifiees.js) ; le service ajoute
 * `org_id`, `intervention_id`, `updated_at`. `added_by` est posé par la base (auth.uid()).
 * Clé unique : (intervention_id, equipment_id, piece_reference, repere), `repere` = '' si absent.
 */
const VUE = 'majordhome_sav_part_selections';
const CONFLIT = 'intervention_id,equipment_id,piece_reference,repere';

function ligne(orgId, interventionId, photo) {
  return {
    ...photo,
    repere: photo.repere ?? '',
    org_id: orgId,
    intervention_id: interventionId,
    updated_at: new Date().toISOString(),
  };
}

export const savPiecesService = {
  /** Pièces identifiées d'une carte, plus anciennes d'abord. */
  list(orgId, interventionId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from(VUE)
        .select('*')
        .eq('org_id', orgId)
        .eq('intervention_id', interventionId)
        .order('added_at', { ascending: true });
      if (error) throw error;
      return data || [];
    }, 'savPieces.list');
  },

  /** quantity > 0 : pose / remplace la ligne ; quantity <= 0 : la retire. */
  setQuantity(orgId, interventionId, photo) {
    return withErrorHandling(async () => {
      if (!(photo.quantity > 0)) {
        const parCle = (q) =>
          q
            .eq('org_id', orgId)
            .eq('intervention_id', interventionId)
            .eq('equipment_id', photo.equipment_id)
            .eq('piece_reference', photo.piece_reference)
            .eq('repere', photo.repere ?? '');
        const { data: supprimees, error } = await parCle(supabase.from(VUE).delete()).select('id');
        if (error) throw error;
        if (supprimees && supprimees.length > 0) return null;
        // 0 ligne supprimée : soit elle n'existait plus (succès), soit la RLS a refusé en silence.
        const { data: restante, error: errLecture } = await parCle(supabase.from(VUE).select('id')).maybeSingle();
        if (errLecture) throw errLecture;
        if (restante) throw new Error('Retrait refusé : la pièce est toujours enregistrée');
        return null;
      }
      const { data, error } = await supabase
        .from(VUE)
        .upsert(ligne(orgId, interventionId, photo), { onConflict: CONFLIT })
        .select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Enregistrement refusé : aucune ligne écrite');
      return data[0];
    }, 'savPieces.setQuantity');
  },

  /** Range plusieurs pièces d'un coup — remplace les quantités, ne cumule pas. → { count } */
  ranger(orgId, interventionId, photos) {
    return withErrorHandling(async () => {
      const lignes = (photos || []).filter((p) => p.quantity > 0).map((p) => ligne(orgId, interventionId, p));
      if (lignes.length === 0) return { count: 0 };
      const { data, error } = await supabase.from(VUE).upsert(lignes, { onConflict: CONFLIT }).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Enregistrement refusé : aucune ligne écrite');
      return { count: data.length };
    }, 'savPieces.ranger');
  },
};
