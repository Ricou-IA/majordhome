/**
 * useAppointmentEntretien.js — entretien / SAV lié au client d'un RDV (sorti d'EventModal).
 * Renvoie l'intervention PARENT complète : CertificatsSection en a besoin (client + contrat)
 * pour lister les équipements et résoudre leurs interventions enfants. Un certificat doit
 * être rattaché à un équipement — ouvrir le formulaire sur le parent produit un certificat
 * orphelin qui n'avance pas le compteur de la fiche entretien.
 */
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

export function useAppointmentEntretien({ isOpen, isEdit, clientId, appointmentType }) {
  const [entretien, setEntretien] = useState(null);

  useEffect(() => {
    setEntretien(null);
    if (!isOpen || !isEdit || !clientId) return;
    if (!['maintenance', 'service'].includes(appointmentType)) return;

    async function lookupEntretien() {
      // Chercher d'abord un entretien pur, puis un SAV avec entretien inclus
      const { data } = await supabase
        .from('majordhome_entretien_sav')
        // project_id / client_project_id : CertificatsSection en a besoin pour créer les
        // enfants (interventions.project_id NOT NULL). Sans eux, la création échouait en
        // 23502 à chaque ouverture d'un RDV entretien (avalé jusqu'au 2026-09-20).
        .select('id, workflow_status, intervention_type, includes_entretien, client_id, contract_id, effective_contract_id, project_id, client_project_id')
        .eq('client_id', clientId)
        .in('workflow_status', ['planifie', 'a_planifier', 'realise'])
        .order('created_at', { ascending: false })
        .limit(10);

      // Priorité : entretien pur > SAV avec entretien inclus
      const match = data?.find(d => d.intervention_type === 'entretien')
        || data?.find(d => d.intervention_type === 'sav' && d.includes_entretien);
      if (match) setEntretien(match);
    }
    lookupEntretien();
  }, [isOpen, isEdit, clientId, appointmentType]);

  return entretien;
}
