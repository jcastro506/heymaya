# Maya's personal memory: architecture and implementation

2026-09-09. Scope: the creator app. Changes in this pass are local and require a normal backend deployment. No production data migration or live model evaluation was run.

## Follow-up implementation: the five priorities

The five requested priorities now have runtime implementations, in addition to the initial recall pass:

| Priority | Implementation |
| --- | --- |
| Preference versus performance | Separate affinity arrays; legacy event replay on first write/nightly maintenance; clean read views in conversation, scout gating, dossier learning and weekly review; outcome events excluded from the taste prose writer. Effort remains an explicit user quote, not inferred from metrics. |
| Evolving style | Frozen weekly style snapshots of 30-day post samples, with measurable caption habits, dated post examples and available observed visual/humour descriptions. Initial maintenance attempts historical windows. Context compares non-overlapping windows with at least five posts each. |
| Reasons and commitments | `personalRecords` stores exact user quotes, explicit reasons, source IDs, and optional owned calendar-block links. Runtime context reads booked/cancelled/filmed state from the action, never from the remembered promise. Records are also searchable by the recall tool. Specialist text routes receive a delayed extraction backstop. |
| Relevant callbacks | Candidate selection considers the current topic and matches recent delivered text to suppress repetition. A direct user reference may override suppression. Merely offering a callback to the writer does not count as having said it. |
| Corrections and forgetting | Source-linked records are invalidated; forgotten source messages, their reply, and repeated verbatim passages are excluded; untraceable legacy dossier/taste/growth summaries are cleared. A memory epoch rejects stale fact, dossier, taste-profile and experience writes. “Forget that” can target a recent experience as well as a note. |

`personalRecords` participates in account export and deletion. Chat-derived records follow the 365-day retention policy; public-post style snapshots can persist. All changes remain local pending deployment. Existing profile prose cleared by forgetting is rebuilt by the normal profile jobs, from remaining evidence.

Verification: full local suite 595 passed, two existing skips; typecheck and guards passed. Focused continuity tests were rerun after final invalidation changes. ESLint reported no errors (two existing unused-variable warnings in onboarding ingestion). Synthetic tests verify behavior and isolation, not the live model's conversational quality. No production deployment, production migration, or external messages were performed.

Operational limits: callback matching is lexical; it is not a semantic repetition judge. Source lineage and verbatim matching do not identify every independently worded paraphrase elsewhere in old content. The correction/extraction model still needs live quality evaluation. Initial style sampling considers 200 stored posts and available reads, not an unlimited historical scan. Legacy signal replay and forgetting currently use per-creator scans and should be paginated before very large accounts. These limits are not a reason to claim universal or permanent recall.

## Product objective

Maya should remember enough of the creator's work and decisions to offer specific, useful continuity: “You passed on tutorials because you wanted these to feel like little films. This format gives you that without the voiceover.” She must be able to find the source, distinguish a past preference from a current one, and admit when she cannot find something. The goal is earned familiarity, not a claim of total recall or a simulation of a human's private life.

## Three layers, one evidence trail

| Layer | Contents | Use |
| --- | --- | --- |
| Current understanding | Explicit preferences, constraints, goals, style profile, standing instructions, present projects | Compact context for every relevant turn; latest user corrections override inferred patterns |
| Episodic history | Conversations, decisions, rejected ideas and reasons, commitments, experiments, milestones | Retrieve by topic, time, people, project, and related post; expand the original evidence when needed |
| Source archive | Messages, captions, transcripts, visual observations, post metrics with observation dates, calendar/action records | Establish what was actually said, seen, agreed, performed, and measured |

Convex remains the system of record. A graph need not be a new database: typed IDs and relation records can connect an idea to its discussion, filming block, published post, and outcome. Obsidian is a possible export/inspection interface, not the runtime memory service.

## Implemented in this pass

- Full-text indexing of retained messages. Searches return a matching message and up to four nearby messages, with a source ID, date, and speaker labels. Already-stored messages become searchable when the new index is deployed; no conversation copy or historical LLM summarization job is required.
- Archive retrieval joins the existing `recall` tool and automatic recall-intent path. All agent skills that receive the common context get explicit instructions to retrieve evidence when past decisions would change the answer.
- Outbound archive results must have been delivered. A historical statement by Maya is explicitly not proof that she performed an action.
- Memory passages are written before embeddings, so failures do not lose the text. Full-text and semantic retrieval are combined by reciprocal rank; up to three delayed embedding retries follow an initial failure. Stale results cannot overwrite a different text revision, and a late failed request cannot erase a successful vector.
- Read-time canonical checks suppress expired, tombstoned, missing, or cross-user note sources and deleted post/idea sources. Search hits retain their IDs through filtering instead of attaching another hit's score by array position.
- `forget that` deletes the selected note's indexed copy and excludes its original message from the recent context and archive search. Delayed extraction cannot restore that same source. This is targeted forgetting, not yet a semantic purge of all paraphrases and derived profiles.
- The fact extractor accepts short replies, sees limited preceding context, and can nominate an existing fact to supersede when the user explicitly corrects it. Mutation checks require an owned inbound source. Interpretation of the correction remains model-dependent and needs live evaluation.
- Post indexing uses batches with continuation, rather than stopping at 200. The returned count is for the current batch; follow-up batches are scheduled. Index success now reflects durable text storage, while embedding status is separate.

## Architectural detail and further extensions

The following design notes describe the broader target, including extensions beyond the five implemented behaviors above.

### 1. A canonical fact ledger and complete invalidation

Move the bounded `creators.notes` array into a paginated fact table. Keep only a selected working set in context. Proposed fields: creatorId, subjectId, predicate, value, sourceIds, explicitOrInferred, validFrom, validUntil, supersedesId, status, and lastConfirmedAt. Do not use an arbitrary model confidence number as proof of truth.

Track the dependencies of every generated profile section on its source facts. Existing facts that already fell out of the 60-note array are fail-closed in recall; restoring useful ones requires a deliberate source-checked migration. This implementation resets legacy profile prose during invalidation. Fine-grained profile provenance would let us preserve unrelated sections instead of rebuilding the whole profile. Independently worded paraphrases still require additional detection.

Reconcile expiry semantics: the nightly job currently preserves confirmed expired notes, while current-context filtering still excludes notes past their expiry. Confirmation should renew a time-bound fact's validity, not make a trip permanent. Contradictory standing instructions also need explicit supersession rather than accumulating indefinitely.

### 2. Conversation episodes and journey milestones

The implemented archive search is lexical, not semantic conversation retrieval. A future episode worker should process completed conversations into concise evidence-linked summaries: topic, decision, rejected alternatives and reason, open commitment, mentioned entities, related content IDs, and source time range. Store both full-text and vector indexes. A summary should be a locator; exact quotes and disputed claims must expand source messages.

Keep ingestion idempotent and checkpointed. Include specialist routes, voice transcripts, shared screenshots, calendar consent and changes, and reactions. Distinguish “Maya suggested,” “creator agreed,” “tool executed,” and “outcome observed.” A chronology of milestones should retain successes and meaningful changes, not just recent winners.

### 3. Style as an evolving model, not a fixed label

The current voice system already uses real caption/hook exemplars and measured writing habits. Add dated style snapshots covering spoken delivery, humour, editing rhythm, camera setup, visual motifs, topics, and audience relationship. Each claim needs representative post IDs and counterexamples. Compare recent work with earlier eras before saying a style has changed.

Creative taste and performance prediction now use separate signals. A winning format does not establish that the creator enjoyed making it; a flop does not establish dislike. Effort and repeatability are retained as explicit quotes. A later ranking model can use these separate dimensions against the creator's goals, without merging them back into a single taste score.

### 4. Experiments and commitments

Create an explicit experiment record: hypothesis, intended change, baseline/comparison window, linked posts, creator preference, observation maturity, result, uncertainty, and next decision. Separate platform metrics and avoid causal claims from one successful post.

Represent promises as obligations tied to actual action records. Follow-up should be triggered by real state: draft received, shoot moved, metrics mature, or deadline passed. A textual “I'll remind you” must never substitute for a scheduled reminder.

### 5. Proactive relevance and relationship pacing

The selector now uses topic overlap and recent delivered-message overlap. Stable callback IDs reported by the writer and verified against its output could further improve tracking when the same memory is paraphrased. Do not mark merely offered candidates as used.

Ask one natural question when a missing detail would improve a real decision. Do not turn familiarity into an intake questionnaire. Adapt message length, directness, timing, and humour from explicit preferences and observed responses. Keep Maya's conversational voice distinct from the creator's publication style. Never fabricate having watched footage, having personal experiences, or privately thinking about the user.

### 6. Retrieval quality and operations

Add source-aware kind/date/entity filters, semantic episode search, source expansion, and a lightweight reranking step only where it measurably helps. The current vector path retrieves 24 candidates before optional kind filtering; lexical retrieval does filter kind. Very large mixed collections need better per-kind vector retrieval. Post visual-card lookup still considers only 300 recent reads, so indexing the whole catalogue alone does not guarantee deep visual memory of old posts.

Expose per-creator coverage: source counts, searchable passages, missing vectors, failed jobs, oldest unindexed source, retrieval latency, and recall misses. The new embeddingState field is a foundation, not a monitoring dashboard. Retry scheduling still needs an operational recovery sweep for exhausted or interrupted jobs.

## Retention and rollout

The existing 365-day message policy is preserved, and archive queries enforce it even before deletion has caught up. Do not retain verbatim chat indefinitely by hiding it in an episode table. Longer-lived distilled memories require an explicit product retention policy and complete deletion/export support.

Deploy the additive schema and functions together through the existing deployment workflow. The new text indexes must be ready before the new query paths run. Reindex posts through `postMemory.indexAll` in a controlled environment; existing missing note passages require a separate source-checked repair. Do not run a broad live backfill or paid model gauntlet merely to test a local change.

## Evaluation before claiming robust long-term memory

Use isolated synthetic creator timelines spanning a year. Cover paraphrases, ambiguous references, multiple similar posts, changed preferences, forgotten facts repeated in summaries, failed embeddings, missing images, unfulfilled promises, specialist routes, deletion during indexing, and cross-user probes. Score factual recall, correct abstention, source attribution, preference accuracy, callback usefulness, repetition, latency, and cost separately.

Local regression coverage in this pass checks archive context and isolation, retention and delivery filtering, text-only retrieval, forgotten-source exclusion and extraction replay, source-owned corrections, and stale embedding writes. Live model extraction quality and production index coverage remain unverified.
