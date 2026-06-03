import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { callCampaignsService } from '@services/callCampaigns.service';
import { MockCallProvider } from '@apps/artisan/components/appels/callProvider';
import { isWithinCallWindow, DEFAULT_CALL_WINDOW } from '@apps/artisan/components/appels/callWindow';
import { callAttemptKeys } from '@hooks/cacheKeys';

const EMPTY_COUNTERS = { dialed: 0, no_answer: 0, voicemail: 0, transfers: 0 };

/**
 * useCallSession — pilote une file d'appels séquentielle (1 à la fois) via un CallProvider.
 * @param {{ orgId: string }} opts
 */
export function useCallSession({ orgId }) {
  const queryClient = useQueryClient();
  const providerRef = useRef(null);
  const sessionRef = useRef(null);
  const contactsRef = useRef([]);
  const [status, setStatus] = useState('idle'); // idle|running|paused|popped|done
  const [counters, setCounters] = useState(EMPTY_COUNTERS);
  const [current, setCurrent] = useState(null);

  const findContact = useCallback((id) => contactsRef.current.find((c) => c.id === id) || null, []);

  const wireProvider = useCallback((provider) => {
    provider.on('dialing', () => setCounters((c) => ({ ...c, dialed: c.dialed + 1 })));

    provider.on('no_answer', async ({ contactId }) => {
      const c = findContact(contactId);
      setCounters((k) => ({ ...k, no_answer: k.no_answer + 1 }));
      await callCampaignsService.recordAttempt({
        orgId, sessionId: sessionRef.current, interventionId: contactId, result: 'no_answer', phone: c?.phone,
      });
    });

    provider.on('voicemail', async ({ contactId }) => {
      const c = findContact(contactId);
      setCounters((k) => ({ ...k, voicemail: k.voicemail + 1 }));
      await callCampaignsService.recordAttempt({
        orgId, sessionId: sessionRef.current, interventionId: contactId, result: 'voicemail', phone: c?.phone,
      });
    });

    provider.on('human_answered', ({ contactId }) => {
      setStatus('popped');
      setCurrent(findContact(contactId));
    });

    provider.on('transfer_missed', async ({ contactId }) => {
      const c = findContact(contactId);
      await callCampaignsService.recordAttempt({
        orgId, sessionId: sessionRef.current, interventionId: contactId, result: 'transfer_missed', phone: c?.phone,
      });
      setCurrent(null);
      setStatus('running');
    });

    provider.on('transfer_accepted', () => setCounters((k) => ({ ...k, transfers: k.transfers + 1 })));

    provider.on('session_done', () => { setStatus('done'); setCurrent(null); });
  }, [orgId, findContact]);

  const start = useCallback(async (contacts, params = DEFAULT_CALL_WINDOW) => {
    if (!isWithinCallWindow(params)) {
      return { error: 'hors_plage_horaire' };
    }
    const { data: sessionId, error } = await callCampaignsService.startSession({ orgId, kanban: 'entretien', params });
    if (error) return { error };
    sessionRef.current = sessionId;
    contactsRef.current = contacts.map((c, i) => ({ ...c, _index: i }));
    const provider = new MockCallProvider({});
    providerRef.current = provider;
    wireProvider(provider);
    setCounters(EMPTY_COUNTERS);
    setStatus('running');
    provider.start(contactsRef.current);
    return { data: sessionId };
  }, [orgId, wireProvider]);

  const pause  = useCallback(() => { providerRef.current?.pause();  setStatus('paused'); }, []);
  const resume = useCallback(() => { providerRef.current?.resume(); setStatus('running'); }, []);
  const stop   = useCallback(() => { providerRef.current?.stop();   setStatus('idle'); setCurrent(null); }, []);

  const acceptTransfer = useCallback(() => {
    if (current) providerRef.current?.resolveTransfer(current.id, true);
  }, [current]);

  const closeCurrent = useCallback(async ({ result, note = null } = {}) => {
    const c = current;
    if (!c) return;
    await callCampaignsService.recordAttempt({
      orgId, sessionId: sessionRef.current, interventionId: c.id, result: result || 'callback', phone: c.phone, note,
    });
    queryClient.invalidateQueries({ queryKey: callAttemptKeys.stats(orgId) });
    setCurrent(null);
    setStatus('running');
    providerRef.current?.advance();
  }, [current, orgId, queryClient]);

  useEffect(() => () => providerRef.current?.stop(), []);

  return useMemo(() => ({
    status, counters, current,
    start, pause, resume, stop, acceptTransfer, closeCurrent,
  }), [status, counters, current, start, pause, resume, stop, acceptTransfer, closeCurrent]);
}
