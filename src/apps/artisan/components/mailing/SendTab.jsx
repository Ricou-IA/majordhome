import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Send, FlaskConical, Loader2, Filter } from 'lucide-react';
import { Button } from '@components/ui/button';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { useAuth } from '@contexts/AuthContext';
import CampaignIdentityPanel from './CampaignIdentityPanel';
import { useMailCampaigns } from '@hooks/useMailCampaigns';
import { useMailSegments, useSegmentCount } from '@hooks/useMailSegments';
import { mailSegmentsService } from '@services/mailSegments.service';

/**
 * Onglet Envoi — sélection de campagne + segment + preview + envoi.
 * Campagnes et segments sont chargés depuis la DB (mail_campaigns + mail_segments).
 */
export default function SendTab() {
  const { organization } = useAuth();
  const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_MAILING;
  const orgId = organization?.id;

  const { campaigns, isLoading: campaignsLoading } = useMailCampaigns(orgId);
  const { segments, isLoading: segmentsLoading } = useMailSegments(orgId);

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

  // Le segment par défaut vient de la campagne si renseigné, sinon premier segment disponible
  useEffect(() => {
    if (!campaign || segments.length === 0) return;
    const preferredId = campaign.auto_segment_id;
    if (preferredId && segments.some((s) => s.id === preferredId)) {
      setSelectedSegmentId(preferredId);
    } else if (!selectedSegmentId || !segments.some((s) => s.id === selectedSegmentId)) {
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
  const iframeRef = useRef(null);

  useEffect(() => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write((htmlBody || '').replace(/\{\{SALUTATION\}\}/g, 'Bonjour Jean Dupont,'));
    doc.close();
  }, [htmlBody]);

  const buildPayload = useCallback(async (isTest = false) => {
    if (!segment) return null;
    const { data: compiledSql, error } = await mailSegmentsService.compileSql({
      filters: segment.filters,
      campaignName: campaignLabel,
      orgId,
    });
    if (error) throw error;
    const sql = compiledSql ? `${String(compiledSql).replace(/;?\s*$/, '')};` : '';
    const recipientType = segment.audience === 'leads' ? 'lead' : 'client';
    return {
      subject,
      html_body: htmlBody,
      segment_sql: sql,
      campaign_name: campaignLabel,
      org_id: orgId,
      recipient_type: recipientType,
      tracking_column: 'emailing_reprise_sent_at',
      tracking_type_column: 'emailing_reprise_type',
      tracking_type_value: campaign?.tracking_type_value || '',
      ...(isTest && testEmail ? { test_email: testEmail } : {}),
    };
  }, [segment, subject, htmlBody, campaignLabel, orgId, campaign, testEmail]);

  const sendToWebhook = useCallback(async (isTest = false) => {
    if (!webhookUrl) {
      toast.error('Variable VITE_N8N_WEBHOOK_MAILING non configurée');
      return;
    }
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

    setSending(true);
    try {
      const payload = await buildPayload(isTest);
      if (!payload) throw new Error('Payload invalide');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      let response;
      try {
        response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') {
          toast.success(
            isTest
              ? `Test envoyé à ${testEmail}`
              : `Campagne lancée ! L'envoi des ${recipientCount ?? ''} mails se poursuit en arrière-plan.`
          );
          setShowConfirm(false);
          return;
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      let result = {};
      try {
        const text = await response.text();
        if (text) result = JSON.parse(text);
      } catch {
        // Réponse non-JSON, on ignore
      }

      toast.success(
        isTest
          ? `Test envoyé à ${testEmail}`
          : `Campagne lancée ! ${result.message || ''}`
      );
      setShowConfirm(false);
    } catch (err) {
      toast.error(`Erreur : ${err.message}`);
    } finally {
      setSending(false);
    }
  }, [webhookUrl, testEmail, buildPayload, recipientCount, subject, segment]);

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
              <Button variant="secondary" onClick={() => sendToWebhook(true)} disabled={sending || !testEmail}>
                {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FlaskConical className="w-4 h-4 mr-2" />}
                Envoyer test
              </Button>

              <Button onClick={() => setShowConfirm(true)} disabled={sending}>
                <Send className="w-4 h-4 mr-2" />
                Lancer la campagne
              </Button>
            </div>
          </div>
        </div>

        <div className="card p-0 overflow-hidden">
          <iframe
            ref={iframeRef}
            title="Preview email"
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
        onConfirm={() => sendToWebhook(false)}
        loading={sending}
      />
    </>
  );
}
