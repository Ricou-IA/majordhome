# Phase 1 — Recherche marché agent IA polyvalent (mai 2026)

> **Cible** : Mayer Énergie (artisan CVC, 5 personnes, Gaillac) — intégration future dans Majord'home (Supabase + N8N + Pennylane + Gmail + Whisper).
> **Cas d'usage** : A) Standard téléphonique entrant ~10/j · B) Triage email ~50/j · C) CR visite terrain ~10/sem · D) CR réunion ~5/sem.

---

## 1. TL;DR (5 lignes)

- **Aucun éditeur unique ne couvre proprement A+B+C+D** en mai 2026 — les notetakers (Granola/Fireflies/Otter) ne font pas de voix téléphonique, et les plateformes voix (Vapi/Retell/Bland) ne font pas de meeting bot.
- **Vapi reste la référence orchestration voix** ($0,05/min plateforme, total réel **$0,15–0,40/min** = ~12–32 c€/min selon stack), mais hébergement EU encore en attente — risque RGPD à anticiper si revente future.
- **ElevenLabs Conversational AI** est l'option la plus "tout-en-un voix" ($0,08–0,12/min agent), **EU data residency disponible mais Enterprise only**, voix française désormais quasi équivalente à l'anglais.
- **Mistral Voxtral (FR, on-prem possible)** est la seule réponse souveraine crédible, mais c'est une stack à assembler soi-même (STT + LLM + TTS), pas un produit clé en main → couvert par **LiveKit Agents** + Voxtral si on veut packager dans Majord'home.
- **Reco** : scénario **HYBRIDE** Vapi (A) + Granola/Fireflies (D) + extension N8N maison sur Majord'home (B+C) — coût mensuel run estimé **~150–250 €/mois HT** pour les volumes Mayer, time-to-prod 4–6 sem, packageable plus tard via abstraction du connecteur voix.

---

## 2. Tableau pricing (mai 2026, prix éditeur)

| Fournisseur | Prix | Inclus | Hébergement | Intégrations clés |
|---|---|---|---|---|
| **Vapi** | $0,05/min orchestration · total réel $0,15–0,40/min selon stack | 10 calls concurrents, 60 min gratuites signup, BYOK pour LLM/TTS/STT | US par défaut, **EU "near future" sans ETA**, on-prem Enterprise | Webhooks, Twilio/Telnyx, ElevenLabs, Deepgram, OpenAI |
| **ElevenLabs Conv. AI** | $0,08/min (Standard), $0,10 (Turbo), $0,12 (Premium gpt-4o) — bill par minute conversation | TTS + STT + LLM + agents tout-en-un, 70+ langues | **EU residency Enterprise only**, Zero Retention Mode dispo en API | Webhooks, Twilio, custom LLM, MCP |
| **Lindy** | Plus $49,99/mo · Pro $99,99 · Max $199,99 · **Business $299/mo** (voix + 100 calls) · numéros $10/mois · voix **$0,19/min** | Workflows multi-skills (mail + voix + meetings limités) | US (Anthropic infra) | Supabase, Pennylane, Gmail natifs (no-code) |
| **Bland AI** | $0,09/min · Build plan $299/mo (per-min plus bas selon plan) · SMS $0,02/msg | Voix + STT + TTS in-house, Pathways graphiques | US, Enterprise custom | Webhooks, peu d'intégrations natives |
| **Retell AI** | $0,07/min base + LLM ($0,003–0,06) + telephony (~$0,015) = **$0,13–0,31/min total** · 20 calls concurrents inclus | Pay-as-you-go, BYOK partiel | US, EU possible self-hosted | Webhooks, Twilio, custom |
| **Synthflow** | $0,09/min voix + LLM ($0,02–0,04) + BYOK ElevenLabs/Deepgram | No-code builder, plans 50→2000 min/mo ($29→$899) | US | Webhooks, CRM connectors |
| **LiveKit Agents** | Build gratuit (1000 min agent + 5000 WebRTC) · Ship $50 · Scale $500 (incl. data residency) · agent **$0,01/min** + WebRTC $0,0004/min + BYOK STT/LLM/TTS | Framework open source, infra cloud ou self-host | **GDPR + EU residency Scale tier**, Telnyx EU dispo | SDK Python/Node, MCP, à assembler |
| **Granola** | Free (25 meetings lifetime) · Individual $18/u/mo · Team $14/u/mo · Business $35/u/mo | Notetaker desktop (pas de bot dans l'appel), template, AI summary | US (en cours de durcissement EU) | Slack, Notion, HubSpot, webhooks |
| **Fireflies.ai** | Free (limité 800 min) · Pro $10/u/mo annuel · Business $19/u/mo annuel | Bot meeting Zoom/Meet/Teams + transcription, channels équipe | US, Pro+ permet data residency limitée | Zapier, CRM, Slack, webhooks |
| **Otter.ai** | Free 300 min/mo · Paid dès $8,33/u/mo | Transcription temps réel, intégration calendrier | US | Zapier, Slack, Salesforce |
| **tl;dv** | Free unlimited transcription · Pro $18/u/mo annuel · Business $98/mo | Bot Zoom/Meet/Teams, sales coaching dans Business | US, EU partial | CRM, Slack, webhooks |
| **Avoma** | Starter $19/u/mo (2400 min) · Plus $49 · Business $79 | CRM-centric, sales scorecards | US | Salesforce, HubSpot, Pipedrive |
| **Mistral Voxtral** | API : tarification à l'usage modeste (Voxtral Mini Transcribe + Realtime + TTS open source) | Modèles ouverts, **on-prem possible**, FR natif | **EU/FR**, on-prem dispo | À assembler (LiveKit, Pipecat, custom) |

---

## 3. Couverture cas A/B/C/D

| Fournisseur | A — Standard tél | B — Triage email | C — CR visite terrain | D — CR réunion |
|---|:-:|:-:|:-:|:-:|
| Vapi | OUI (cœur) | non | partiel (via Whisper externe) | non |
| ElevenLabs Conv. AI | OUI (cœur) | non | partiel (transcription) | non |
| Lindy | OUI (limité 100/mo) | OUI (cœur) | OUI (workflow) | partiel (no native bot) |
| Bland / Retell / Synthflow | OUI (cœur) | non | non | non |
| Granola | non | non | OUI (mémo desktop) | OUI (cœur) |
| Fireflies / Otter / tl;dv / Avoma | non | non | partiel (mobile transcribe) | OUI (cœur) |
| LiveKit + Voxtral | OUI (à coder) | non | OUI (à coder) | partiel (à coder) |

→ **Aucune solution unique** ne couvre les 4 cas proprement. Lindy est le moins mauvais "tout-en-un", mais voix limitée à 100 calls/mois sur Business $299 et qualité voix française non documentée publiquement.

---

## 4. État de l'art voix française (mai 2026)

La qualité voix française a basculé en 2025/2026 — ElevenLabs Multilingual v2 et Flash v2.5 (75 ms TTS-only) ont rapproché la voix FR de l'anglais, et Vapi/Retell/Bland exploitent ces moteurs derrière. Latence end-to-end conversationnelle réelle **~300–500 ms** quand bien tunée (Vapi atteint 465 ms documenté), au-dessus du seuil de naturalité humaine (200 ms) mais acceptable pour un standard. Côté STT, Deepgram Flux Multilingual et AssemblyAI Universal-3 Pro Streaming supportent FR temps réel avec EU residency (Dublin pour AssemblyAI, EU endpoints pour Deepgram). Côté souverain, **Mistral Voxtral** (Transcribe V2 + Realtime + TTS open source mars 2026) est le seul stack STT+LLM+TTS 100% européen et on-prem-able, mais demande de l'intégration (LiveKit Agents ou Pipecat). Pour Mayer en 2026, le mieux **fonctionnellement** reste ElevenLabs/Vapi avec voix FR ; le mieux **stratégiquement long terme** (revente Majord'home) est de prévoir un connecteur abstrait pour pouvoir basculer sur Voxtral quand la stack open source sera mûre.

---

## 5. Cas concrets PME françaises

**Honnêtement** : les chiffres "+40 % devis traités", "+25–35 % conversion", "12 prospects/sem hors heures" qui circulent viennent quasi-exclusivement de **pages marketing d'éditeurs FR** (Nerolia, AirAgent, Vocalis, Operium, Goodev, agence-ia.com) et ne sont pas étayés par des cas nominatifs publics. Aucun témoignage LinkedIn artisan CVC/plombier identifiable nominativement n'est apparu dans les recherches. Le seul retour d'expérience sérieux trouvé est le post Substack d'**Optimia** ("Agent vocal IA : ce que l'on peut vraiment automatiser en 2025") qui décrit plutôt les limites (intentions complexes, repli humain nécessaire, latence perçue) — à lire avant tout déploiement. **Conclusion** : marché FR encore jeune, pas de benchmark public crédible sur le segment artisan. Mayer serait plutôt early adopter — d'où l'intérêt de packager la solution pour la revendre ensuite.

---

## 6. Trois scénarios reco

### Scénario BUY tout-en-un — **Lindy Business**
- **Stack** : Lindy Business ($299/mo) + numéro FR ($10) + voix consommée (~100 min/mo × $0,19 = $19) ≈ **$330/mo (~305 €)**.
- **Couvre** : A (limité), B, partiellement C et D (workflows manuels, pas de bot meeting natif).
- **TTP** : 2–3 sem (no-code).
- **Risques** : qualité voix FR non documentée, plafond 100 calls/mo trop juste si Mayer scale, hébergement US, **non packageable** dans Majord'home (vendor lock-in).

### Scénario HYBRIDE — **Vapi + Granola + Majord'home N8N** ⭐ recommandé
- **Stack A** : Vapi ($0,05) + Deepgram FR ($0,01) + ElevenLabs Turbo FR ($0,05) + GPT-4o-mini ($0,01) + Twilio FR (~$0,02) ≈ **$0,14/min**. À 10 appels/j × 3 min × 22 j ouvrés = 660 min/mo ≈ **$92/mo (~85 €)**.
- **Stack D** : Granola Team $14/u × 5 = **$70/mo (~65 €)** ou Fireflies Pro $10 × 5 = $50.
- **Stack B+C** : extension N8N + Whisper + GPT-4o sur Majord'home existant ≈ **0 € marginal** (déjà payé).
- **Total run** : **~150–180 €/mo HT** pour Mayer.
- **TTP** : 4–6 sem (Vapi prompt + tunnels Twilio + intégration webhook → `majordhome_leads` + N8N email triage).
- **Risques** : Vapi pas EU-hosted (anticiper migration vers ElevenLabs Conv. AI EU Enterprise ou LiveKit+Voxtral si revente Majord'home), 4 fournisseurs à gérer.
- **Packageabilité** : EXCELLENTE — abstraire `voiceProvider` dans Majord'home (interface webhook + transcript + intent), brancher Vapi v1, prévoir Voxtral v2 souverain plus tard.

### Scénario MAKE max — **LiveKit Agents + Voxtral + Whisper sur Majord'home**
- **Stack** : LiveKit Ship $50/mo + agent minutes ($0,01) + Voxtral self-hosted (€~0/min hors infra) + Twilio FR (~$0,02) + Whisper API ou local ≈ **$60–100/mo**.
- **Couvre** : A + B + C + D si on développe les bricks meeting bot soi-même (gros effort).
- **TTP** : 3–6 mois (équivalent ~1 sprint dev plein temps + tuning).
- **Risques** : effort dev majeur, Voxtral encore jeune (mars 2026), pas de SaaS managé → on supporte tout.
- **Avantage** : 100 % souverain EU/FR, intégration native Supabase/Pennylane, **packageable et revendable** à d'autres artisans comme module premium Majord'home.

---

## 7. Sources

- [Vapi Pricing 2026 — pxlpeak breakdown $0,05 vs $0,15–0,40 réel](https://pxlpeak.com/blog/ai-tools/vapi-pricing-breakdown)
- [Vapi pricing officiel](https://vapi.ai/pricing)
- [Vapi GDPR / EU hosting community thread](https://vapi.ai/community/m/1371497847073017977)
- [Vapi On-Premise EU Residency](https://vapi.ai/community/m/1400136126856953946)
- [ElevenLabs pricing & API](https://elevenlabs.io/pricing)
- [ElevenLabs Conversational AI per-minute](https://help.elevenlabs.io/hc/en-us/articles/29298065878929-How-much-does-ElevenAgents-cost)
- [ElevenLabs Data Residency EU (Enterprise)](https://elevenlabs.io/docs/overview/administration/data-residency)
- [Lindy pricing officiel](https://www.lindy.ai/pricing)
- [Lindy Pricing Guide CloudTalk 2026](https://www.cloudtalk.io/blog/lindy-ai-pricing/)
- [Lindy Supabase integration](https://www.lindy.ai/integrations/supabase-management-api)
- [Lindy Pennylane integration](https://www.lindy.ai/integrations/pennylane)
- [Bland AI pricing officiel](https://docs.bland.ai/platform/billing)
- [Retell AI pricing officiel](https://www.retellai.com/pricing)
- [Synthflow pricing 2026](https://pxlpeak.com/blog/ai-tools/synthflow-pricing-guide)
- [LiveKit pricing officiel](https://livekit.com/pricing)
- [LiveKit Cloud GDPR/SOC2/HIPAA](https://livekit.com/products/agent-platform)
- [Telnyx LiveKit EU launch avr. 2026](https://www.cloudcommunications.com/news/telnyx-launches-livekit-on-telnyx)
- [Mistral Voxtral STT V2](https://www.trendingtopics.eu/mistral-ai-launches-voxtral-transcribe-2-for-real-time-speech-recognition/)
- [Mistral Voxtral TTS open source mars 2026](https://techcrunch.com/2026/03/26/mistral-releases-a-new-open-source-model-for-speech-generation/)
- [Voxtral page Mistral](https://mistral.ai/news/voxtral)
- [Deepgram Flux Multilingual EU/FR](https://deepgram.com/learn/deepgram-launches-flux-multilingual-press-release)
- [AssemblyAI Universal-3 Pro Streaming FR + EU Dublin](https://www.assemblyai.com/blog/deepgram-alternatives)
- [Granola vs Fireflies vs Otter vs Fathom — pricing 2026](https://www.granola.ai/blog/meeting-note-tool-pricing-granola-vs-fireflies-fathom-otter)
- [tl;dv vs Avoma 2026](https://tldv.io/blog/tldv-vs-avoma-which-ai-meeting-assistant-do-you-need/)
- [Fireflies pricing 2026](https://costbench.com/software/ai-meeting-assistants/fireflies-ai/)
- [Granola pricing 2026](https://costbench.com/software/ai-meeting-assistants/granola/)
- [Vapi vs ElevenLabs latency / FR voice](https://www.goodcall.com/voice-ai/vapi-vs-elevenlabs)
- [Optimia — retour d'expérience honnête agent vocal IA FR](https://optimia.substack.com/p/agent-vocal-ia-ce-que-lon-peut-vraiment)
- [Nerolia — guide standard téléphonique IA PME (marketing FR)](https://nerolia-ai.fr/blog/standard-telephonique-ia-automatiser-accueil-entreprise)
- [Goodev — agents vocaux IA artisans bâtiment (marketing FR)](https://goodev.fr/blog/standard-telephonique-ia-artisan-batiment-par-metier/)
