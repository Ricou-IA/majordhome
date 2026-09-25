// src/apps/artisan/pages/settings/maintenance/BorneTab.jsx
// Compte de la borne d'atelier : un compte Supabase dédié, simple membre de l'org
// (spec § 2, option 1-B). Il voit ce que voit tout membre ⇒ GARDE-FOU : création refusée
// si l'org possède des clients (le CRM serait lisible depuis l'atelier). Le jour où c'est
// bloquant, passer au jeton d'appareil (option 1-A de la spec).
// Les comptes borne sont listés dans settings.maintenance.kiosk_user_ids (redirection
// directe vers /maintenance/borne à la connexion).
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, ShieldAlert, MonitorPlay } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useOrgMembers } from '@hooks/usePermissions';
import { useMaintenanceClientsCount } from '@hooks/useMaintenance';
import { permissionsService } from '@services/permissions.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { FormField, TextInput } from '@apps/artisan/components/FormFields';

export default function BorneTab() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { settings, save } = useOrgSettings();
  const { members } = useOrgMembers(orgId);
  const clients = useMaintenanceClientsCount(orgId);
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');

  const kioskIds = settings?.maintenance?.kiosk_user_ids || [];
  const comptes = (members || []).filter((m) => kioskIds.includes(m.user_id));
  const emailMembre = (members || []).some((m) => (m.profile?.email || m.email || '').toLowerCase() === email.trim().toLowerCase());

  const creer = useMutation({
    mutationFn: async () => {
      const data = await unwrapResult(permissionsService.inviteMember({
        email, password: motDePasse, fullName: 'Borne atelier', orgId, effectiveRole: 'technicien',
      }));
      const userId = data?.user?.id;
      if (!userId) throw new Error('Compte créé sans identifiant renvoyé : vérifier dans Équipe');
      await save({ maintenance: { ...(settings?.maintenance || {}), kiosk_user_ids: [...new Set([...kioskIds, userId])] } });
      return userId;
    },
    onSuccess: () => {
      toast.success('Compte borne créé. Connectez-vous avec ce compte sur le Raspberry Pi.');
      setEmail('');
      setMotDePasse('');
    },
    onError: (err) => toast.error(`Création impossible : ${err?.message || 'erreur inconnue'}`),
  });

  if (clients.isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>;

  const aDesClients = (clients.data || 0) > 0;
  const valide = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && motDePasse.length >= 8 && !emailMembre;

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-sm text-secondary-600">
        La borne se connecte avec son propre compte, puis reste ouverte en plein écran sur{' '}
        <span className="font-mono">/maintenance/borne</span>. Elle affiche les tâches du jour et enregistre
        les réalisations signées par prénom + code PIN.
      </p>

      {comptes.length > 0 && (
        <div className="card space-y-2">
          <p className="font-medium text-secondary-900">Comptes borne</p>
          {comptes.map((m) => (
            <p key={m.user_id} className="flex items-center gap-2 text-sm text-secondary-700">
              <MonitorPlay className="w-4 h-4 text-secondary-500" /> {m.profile?.email || m.email || m.user_id}
            </p>
          ))}
        </div>
      )}

      {clients.isError && <div className="card text-red-700">Vérification impossible (nombre de clients). Réessayez.</div>}

      {aDesClients ? (
        <div className="flex gap-3 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          <ShieldAlert className="w-5 h-5 flex-shrink-0" />
          <p>
            Création refusée : l&apos;organisation contient {clients.data} client{clients.data > 1 ? 's' : ''}.
            Un compte borne voit tout ce que voit un membre, ces données seraient lisibles depuis l&apos;atelier.
            Une borne sécurisée par jeton d&apos;appareil est nécessaire dans ce cas : contactez le support Majord&apos;home.
          </p>
        </div>
      ) : !clients.isError && (
        <form className="card space-y-4" onSubmit={(e) => { e.preventDefault(); if (valide) creer.mutate(); }}>
          <p className="font-medium text-secondary-900">Créer un compte borne</p>
          <FormField label="E-mail du compte borne" error={emailMembre ? 'Cette adresse appartient déjà à un membre de l’organisation.' : null}>
            <TextInput type="email" value={email} onChange={setEmail} placeholder="borne-atelier@entreprise.fr" />
          </FormField>
          <FormField label="Mot de passe (8 caractères minimum)">
            <TextInput type="password" autoComplete="new-password" value={motDePasse} onChange={setMotDePasse} />
          </FormField>
          <button type="submit" disabled={!valide || creer.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {creer.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Créer le compte borne
          </button>
        </form>
      )}
    </div>
  );
}
