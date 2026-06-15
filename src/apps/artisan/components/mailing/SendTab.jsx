import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Send, FlaskConical, Loader2, Filter } from 'lucide-react';
import { Button } from '@components/ui/button';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { useAuth } from '@contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import CampaignIdentityPanel from './CampaignIdentityPanel';
import { useMailCampaigns } from '@hooks/useMailCampaigns';
import { useMailSegments, useSegmentCount } from '@hooks/useMailSegments';

/**
 * Onglet Envoi — sélection de campagne + segment + preview + envoi.
 * Campagnes et segments sont chargés depuis la DB (mail_campaigns + mail_segments).
 *
 * P0.8 V2 — L'envoi passe par l'edge function `mailing-send` (Supabase) au lieu
 * du webhook N8n public. Le SQL est compilé + exécuté côté serveur via la RPC
 * `mail_fetch_recipients` qui inclut un check membership multi-tenant.
 */
export default function SendTab() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const { campaigns: allCampaigns, isLoading: campaignsLoading } = useMailCampaigns(orgId);
  const { segments, isLoading: segmentsLoading } = useMailSegments(orgId);

  // Les campagnes transactionnelles (déclenchées 1-à-1 depuis le code, ex: proposition contrat)
  // ne sont pas broadcast-ables — elles restent dans Éditeur et Stats mais sont exclues d'ici.
  const campaigns = useMemo(
    () => allCampaigns.filter((c) => !c.is_transactional),
    [allCampaigns]
  );

  const [selectedId, setSelectedId] = useState(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState(null);
  const [testEmail, setTestEmail] = useState('');

  useEffect(() => {
    if (!selectedId && campaigns.length > 0) {
      setSelectedId(campaigns[0].id);
    }
  }, [campaigns, selectedId]);

  const campaign = useMemo(
    () => campaigns.find((c) => c.id === selectedId) || null,
    [campaigns, selectedId]
  );
  const campaignLabel = campaign?.label || 'custom';

  // Segment par défaut : appliqué UNIQUEMENT au changement de campagne (auto_segment_id
  // si renseigné, sinon premier segment). On ne le re-force PAS à chaque render — sinon
  // toute sélection manuelle de l'utilisateur est immédiatement annulée (sélecteur figé).
  const initializedCampaignRef = useRef(null);
  useEffect(() => {
    if (!campaign || segments.length === 0) return;

    if (initializedCampaignRef.current !== campaign.id) {
      // Nouvelle campagne → (ré)applique son segment par défaut.
      initializedCampaignRef.current = campaign.id;
      const preferredId = campaign.auto_segment_id;
      if (preferredId && segments.some((s) => s.id === preferredId)) {
        setSelectedSegmentId(preferredId);
      } else {
        setSelectedSegmentId(segments[0].id);
      }
      return;
    }

    // Même campagne : on ne corrige que si la sélection est vide/invalide (ex. liste de
    // segments qui vient de charger). Le choix manuel de l'utilisateur est respecté.
    if (!selectedSegmentId || !segments.some((s) => s.id === selectedSegmentId)) {
      setSelectedSegmentId(segments[0].id);
    }
  }, [campaign, segments, selectedSegmentId]);

  const segment = useMemo(
    () => segments.find((s) => s.id === selectedSegmentId) || null,
    [segments, selectedSegmentId]
  );

  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState('');

  useEffect(() => {
    if (!campaign) return;
    setSubject(campaign.subject || '');
    setHtmlBody(campaign.html_body || '');
  }, [campaign]);

  // Compteur live via RPC mail_segment_count
  const { data: recipientCount, isLoading: countLoading } = useSegmentCount({
    filters: segment?.filters,
    campaignName: campaignLabel,
    orgId,
    enabled: !!segment && !!orgId,
  });

  const [showConfirm, setShowConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  // Progression de l'envoi bulk par vagues (v12) : { wave, sent, failed, remaining }
  const [bulkProgress, setBulkProgress] = useState(null);
  const iframeRef = useRef(null);

  useEffect(() => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    // Substitutions alignées avec l'edge mailing-send pour que la preview reflète
    // le rendu final reçu par les destinataires (squelette + placeholders).
    const s = (organization?.settings ?? {});
    const contactEmail = s.from_email || s.reply_to || 'contact@mayer-energie.fr';
    const replacements = {
      '{{SALUTATION}}': 'Bonjour Jean Dupont,',
      '{{CLIENT_NAME}}': 'Jean Dupont',
      '{{BRAND_NAME}}': s.brand_name || "Majord'home",
      '{{ORG_EMAIL}}': contactEmail,
      '{{ORG_PHONE}}': s.phone || '',
      '{{ORG_ADDRESS}}': s.address || '',
      '{{ORG_POSTAL_CODE}}': s.postal_code || '',
      '{{ORG_CITY}}': s.city || '',
      '{{ORG_WEBSITE_URL}}': s.website_url || '',
      '{{ACCENT_COLOR}}': s.accent_color || '#f97316',
      '{{SECONDARY_COLOR}}': s.secondary_color || '#1E4D8C',
      '{{EMAIL_TAGLINE}}': s.email_tagline || '',
      '{{LOGO_URL}}': s.logo_url || '',
    };
    // Wrap dans le squelette commun si défini ET le template ne contient pas
    // déjà un HTML complet (rétrocompat templates legacy).
    const rawBody = htmlBody || '';
    const isLegacyFullHtml = /<!doctype/i.test(rawBody) || /<html[\s>]/i.test(rawBody);
    const skeleton = s.email_skeleton_html;
    let rendered = (skeleton && !isLegacyFullHtml)
      ? skeleton.split('{{EMAIL_BODY}}').join(rawBody)
      : rawBody;
    for (const [key, value] of Object.entries(replacements)) {
      rendered = rendered.split(key).join(value);
    }
    doc.open();
    doc.write(rendered);
    doc.close();
  }, [htmlBody, organization]);

  const sendCampaign = useCallback(async (isTest = false) => {
    if (isTest && !testEmail) {
      toast.error('Renseigne un email de test');
      return;
    }
    if (!subject?.trim()) {
      toast.error("L'objet du mail est vide — modifie-le ou édite la campagne pour le renseigner");
      return;
    }
    if (!segment) {
      toast.error('Sélectionne un segment de ciblage');
      return;
    }

    const body = {
      mode: 'bulk',
      segment_id: segment.id,
      subject,
      html_body: htmlBody,
      campaign_name: campaignLabel,
      ...(isTest ? { test_email: testEmail } : {}),
    };

    setSending(true);
    try {
      // Mode test : 1 destinataire, un seul appel.
      if (isTest) {
        const { data, error } = await supabase.functions.invoke('mailing-send', { body });
        if (error) throw error;
        if (data?.success === false) throw new Error(data?.error || 'Échec envoi test');
        toast.success(`Test envoyé à ${testEmail}`);
        setShowConfirm(false);
        return;
      }

      // Envoi bulk par vagues (mailing-send v12) : l'edge plafonne chaque
      // invocation à ~300 envois (wall-clock 150 s + rate limit Resend 5/s)
      // et répond { remaining, complete }. On enchaîne les vagues jusqu'à
      // épuisement — l'exclusion `NOT IN mailing_logs WHERE campaign_name = X`
      // côté DB garantit la reprise sans doublon (y compris après une
      // interruption : recliquer reprend où c'était arrêté).
      setShowConfirm(false);
      setBulkProgress({ wave: 0, sent: 0, failed: 0, remaining: recipientCount ?? null });
      const MAX_WAVES = 40; // garde-fou (40 × 300 = 12 000 mails)
      let totalSent = 0;
      let totalFailed = 0;
      let wave = 0;
      for (;;) {
        wave += 1;
        const { data, error } = await supabase.functions.invoke('mailing-send', { body });
        if (error) throw error;
        if (data?.success === false) throw new Error(data?.error || 'Échec envoi');
        totalSent += data?.sent ?? 0;
        totalFailed += data?.failed ?? 0;
        const remaining = data?.remaining ?? 0;
        setBulkProgress({ wave, sent: totalSent, failed: totalFailed, remaining });
        // Rétrocompat : une edge sans batching ne renvoie pas `complete` → one-shot.
        if (data?.complete ?? true) break;
        // Garde anti-boucle : si une vague ne traite plus rien, on sort.
        if ((data?.processed ?? 0) === 0) break;
        if (wave >= MAX_WAVES) {
          toast.warning(
            `Envoi interrompu après ${MAX_WAVES} vagues — reclique sur « Lancer la campagne » pour continuer (reprise sans doublon).`
          );
          break;
        }
      }
      toast.success(
        `Campagne envoyée : ${totalSent} mail${totalSent > 1 ? 's' : ''} en ${wave} vague${wave > 1 ? 's' : ''}` +
        (totalFailed ? ` — ${totalFailed} échec${totalFailed > 1 ? 's' : ''} (voir Stats)` : '')
      );
    } catch (err) {
      if (isTest) {
        toast.error(`Erreur : ${err.message}`);
      } else {
        toast.error(
          `Erreur pendant l'envoi : ${err.message} — reclique sur « Lancer la campagne » pour reprendre là où c'était arrêté (aucun doublon).`
        );
      }
    } finally {
      setSending(false);
      setBulkProgress(null);
    }
  }, [segment, subject, htmlBody, campaignLabel, testEmail, recipientCount]);

  if (campaignsLoading || segmentsLoading) {
    return (
      <div className="card p-8 flex items-center justify-center text-secondary-500">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        Chargement…
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="card p-8 text-center text-secondary-500">
        Aucune campagne enregistrée. Utilise l'éditeur pour en créer une.
      </div>
    );
  }

  // Groupement segments par audience
  const clientSegments = segments.filter((s) => s.audience === 'clients');
  const leadSegments = segments.filter((s) => s.audience === 'leads');

  return (
    <>
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-4">

          <div className="card p-4 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-1">Campagne</label>
                <select
                  value={selectedId || ''}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                >
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-1">
                  <Filter className="w-3.5 h-3.5 inline mr-1" />
                  Segment
                  {countLoading ? (
                    <Loader2 className="w-3 h-3 inline ml-2 animate-spin text-secondary-400" />
                  ) : recipientCount !== null && recipientCount !== undefined ? (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-700">
                      {recipientCount} destinataire{recipientCount > 1 ? 's' : ''}
                    </span>
                  ) : null}
                </label>
                <select
                  value={selectedSegmentId || ''}
                  onChange={(e) => setSelectedSegmentId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                >
                  {clientSegments.length > 0 && (
                    <optgroup label="Clients">
                      {clientSegments.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {leadSegments.length > 0 && (
                    <optgroup label="Leads">
                      {leadSegments.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-1">Objet du mail</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                placeholder="Objet du mail..."
              />
            </div>
          </div>

          <CampaignIdentityPanel campaign={campaign} />

          <div className="card p-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-1">Email de test (optionnel)</label>
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                placeholder="test@exemple.fr"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => sendCampaign(true)} disabled={sending || !testEmail}>
                {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FlaskConical className="w-4 h-4 mr-2" />}
                Envoyer test
              </Button>

              <Button onClick={() => setShowConfirm(true)} disabled={sending}>
                <Send className="w-4 h-4 mr-2" />
                Lancer la campagne
              </Button>
            </div>

            {sending && bulkProgress && (
              <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2.5 text-sm text-primary-800">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                  <span>
                    {bulkProgress.wave === 0
                      ? 'Préparation de l’envoi…'
                      : `Vague ${bulkProgress.wave} — ${bulkProgress.sent} envoyé${bulkProgress.sent > 1 ? 's' : ''}` +
                        (bulkProgress.failed > 0 ? `, ${bulkProgress.failed} échec${bulkProgress.failed > 1 ? 's' : ''}` : '') +
                        (bulkProgress.remaining > 0 ? ` — reste ~${bulkProgress.remaining}` : '')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-primary-600">
                  Garde cet onglet ouvert jusqu'à la fin. En cas d'interruption, relancer reprend sans doublon.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="card p-0 overflow-hidden">
          <iframe
            ref={iframeRef}
            title="Preview email"
            sandbox="allow-same-origin"
            className="w-full border-0"
            style={{ minHeight: '700px' }}
          />
        </div>
      </div>

      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title="Lancer la campagne"
        description={`Tu es sur le point d'envoyer la campagne "${campaignLabel}" au segment "${segment?.name || '?'}" (${recipientCount ?? '?'} destinataires). Cette action est irréversible.`}
        confirmLabel="Lancer l'envoi"
        variant="default"
        onConfirm={() => sendCampaign(false)}
        loading={sending}
      />
    </>
  );
}
