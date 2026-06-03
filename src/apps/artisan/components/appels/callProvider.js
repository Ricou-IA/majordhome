/**
 * callProvider.js — Abstraction du fournisseur d'appels.
 * V1 : MockCallProvider (simulation). Spec n°2 : provider réel (Vapi/Telnyx + PBX).
 *
 * Événements émis (1 argument { contactId, ... }) :
 *   'dialing' | 'no_answer' | 'voicemail' | 'human_answered'
 *   | 'transfer_accepted' | 'transfer_missed' | 'session_done'
 */

export class CallProvider {
  constructor() { this._handlers = {}; }
  on(event, fn)  { (this._handlers[event] ||= new Set()).add(fn); return () => this.off(event, fn); }
  off(event, fn) { this._handlers[event]?.delete(fn); }
  _emit(event, payload) { this._handlers[event]?.forEach((fn) => fn(payload)); }

  // À implémenter par les sous-classes :
  start(_contacts, _params) { throw new Error('not_implemented'); }
  pause() {}
  resume() {}
  stop()  {}
  /** Appelé par l'UI quand l'humain a pris (ou non) le transfert. */
  resolveTransfer(_contactId, _accepted) {}
}

/**
 * MockCallProvider — rejoue un scénario déterministe pour développer/tester sans téléphonie.
 * outcomes : map optionnelle { [contactId]: 'no_answer'|'voicemail'|'human_answered' }
 *            défaut : alterne non_décroché / répondeur / décroché.
 */
export class MockCallProvider extends CallProvider {
  constructor({ outcomes = {}, stepMs = 800, transferTimeoutMs = 8000 } = {}) {
    super();
    this.outcomes = outcomes;
    this.stepMs = stepMs;
    this.transferTimeoutMs = transferTimeoutMs;
    this._queue = [];
    this._paused = false;
    this._stopped = false;
    this._timer = null;
    this._pendingTransfer = null; // { contactId, timer }
  }

  start(contacts) {
    this._queue = [...contacts];
    this._stopped = false;
    this._paused = false;
    this._next();
  }

  pause()  { this._paused = true;  clearTimeout(this._timer); }
  resume() { if (this._paused && !this._stopped) { this._paused = false; this._next(); } }
  stop()   { this._stopped = true; clearTimeout(this._timer); this._clearTransfer(); this._queue = []; }

  _defaultOutcome(i) { return ['no_answer', 'voicemail', 'human_answered'][i % 3]; }

  _next() {
    if (this._stopped || this._paused) return;
    if (this._queue.length === 0) { this._emit('session_done', {}); return; }
    const contact = this._queue.shift();
    const outcome = this.outcomes[contact.id] || this._defaultOutcome(contact._index ?? 0);
    this._emit('dialing', { contactId: contact.id });
    this._timer = setTimeout(() => {
      if (this._stopped || this._paused) return;
      if (outcome === 'human_answered') {
        this._emit('human_answered', { contactId: contact.id });
        // attend resolveTransfer() ; fallback si l'humain ne prend pas
        const t = setTimeout(() => {
          this._emit('transfer_missed', { contactId: contact.id });
          this._pendingTransfer = null;
          this._next();
        }, this.transferTimeoutMs);
        this._pendingTransfer = { contactId: contact.id, timer: t };
      } else {
        this._emit(outcome, { contactId: contact.id }); // no_answer | voicemail
        this._next();
      }
    }, this.stepMs);
  }

  resolveTransfer(contactId, accepted) {
    if (!this._pendingTransfer || this._pendingTransfer.contactId !== contactId) return;
    clearTimeout(this._pendingTransfer.timer);
    this._pendingTransfer = null;
    this._emit(accepted ? 'transfer_accepted' : 'transfer_missed', { contactId });
    // l'avancement de la file après close est piloté par le hook (advance())
  }

  /** Le hook appelle advance() après que l'humain a cliqué un geste de close. */
  advance() { this._next(); }

  _clearTransfer() { if (this._pendingTransfer) { clearTimeout(this._pendingTransfer.timer); this._pendingTransfer = null; } }
}
