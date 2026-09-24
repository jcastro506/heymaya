# Eval + tracing tooling spike

*2026-09-24 · research only; no code changed · written against `codex/creator-ios-app` (`~/Desktop/heymaya-ios`)*

## 1. Recommendation

**Adopt Langfuse Cloud (EU region, Core plan) as the place where traces, bench datasets, judge scores and the operator's labels live. Send it data as plain OTLP/HTTP-JSON using the OpenTelemetry GenAI attribute names, from a small `fetch` exporter we write ourselves. Don't use the Langfuse tracing SDK.** Four reasons:
- The v5 TS tracing SDK boots `@opentelemetry/sdk-node`, so it only runs in Node. Plain `fetch` runs in Convex's default runtime ([OTel endpoint](https://langfuse.com/docs/opentelemetry/get-started), [SDK](https://langfuse.com/docs/observability/sdk/typescript/overview), [Convex runtimes](https://docs.convex.dev/functions/runtimes)).
- Datasets and LLM-as-judge are on every plan. Every feature, including annotation queues, is MIT-licensed if we ever self-host ([pricing](https://langfuse.com/pricing), [OSS](https://langfuse.com/blog/2025-06-04-open-sourcing-langfuse-product)).
- It ships the two pieces we are missing: a PR gate (`langfuse/experiment-action` fails the build with `RegressionError` below a threshold, [CI docs](https://langfuse.com/docs/evaluation/experiments/experiments-ci-cd)), and judge-vs-human agreement as Cohen's kappa ([score analytics](https://langfuse.com/docs/evaluation/evaluation-methods/score-analytics)).
- The wire format is OTLP, so switching to LangSmith, Braintrust or Phoenix later means changing one URL and one header, not rewriting the instrumentation.

**What we don't adopt:**
- No agent framework (see §2b).
- None of the vendors' LLM wrappers or auto-instrumentation. `callModel` stays the only path to a model.
- The judge runs in our code, not a hosted judge. The bench cases stay in the repo as the source of truth. Langfuse holds a synced, versioned copy.
- No self-hosting for now: ClickHouse + Postgres + Redis + S3 is too much to run for one founder ([architecture](https://langfuse.com/self-hosting)).

## 2. Comparison

Volume assumed: 200 creators × ~30 calls/day ≈ 180k model calls/month. Adding tool spans, turn roots and scores gives ≈ **350k trace units/month**, plus a 50-case bench on each prompt change.

| | **Langfuse** | **Braintrust** | **LangSmith (no LangChain)** | **Arize Phoenix** | **Promptfoo** |
|---|---|---|---|---|---|
| From a Convex action | OTLP HTTP/JSON+protobuf via `fetch` ✅ default runtime. Tracing SDK is Node-only; `@langfuse/client` handles datasets and scores | OTLP `api.braintrust.dev/otel` ✅; SDK claims edge support via `@braintrust/otel` ([docs](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry)) | OTLP `api.smith.langchain.com/otel` + `x-api-key` ✅ ([docs](https://docs.langchain.com/langsmith/trace-with-opentelemetry)) | OTLP ✅ (OpenInference attributes) | ❌ no production tracing. It's a CLI eval runner |
| Datasets / versioning | Datasets; fetch by version timestamp for reproducible runs ([docs](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk)) | Strong: datasets + experiments diffing | Datasets + experiments | Datasets + experiments | YAML test files in git |
| CI gate | `langfuse/experiment-action` + `RegressionError` threshold, PR comment | `braintrustdata/eval-action`, PR comment + threshold ([action](https://github.com/braintrustdata/eval-action)) | SDK `evaluate()` + our own threshold script | SDK + our own script | GitHub Action, PR before/after comment ([docs](https://www.promptfoo.dev/docs/integrations/github-action/)) |
| LLM judge | Managed evaluators on live traces or experiments; every judge run is itself traced ([docs](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge)) | Autoevals + custom scorers | Custom evaluators, pairwise | Evals library | `llm-rubric` assertions |
| Human labels | Annotation queues (Core: 3); **kappa/F1 judge-vs-human** built in | Human review UI | Annotation queues | Annotations | Web viewer only, no queue |
| Cost at our scale | **Core $29 + ~$20 overage ≈ $50/mo** ($8/100k units; 90-day retention). Pro $199 for 3-year retention | Free tier is 1 GB / 14 days, too small. **Pro $249/mo** (5 GB, 30-day) ([pricing](https://www.braintrust.dev/pricing)) | Plus $39/seat + usage (LCU/LSU units, hard to predict; base traces 14-day) ([pricing](https://www.langchain.com/pricing)) | Self-host free (ELv2). AX Pro $50 = 50k spans, far under 350k ([pricing](https://arize.com/pricing/)) | Free (OSS) |
| Residency / privacy | EU / US / JP cloud regions; MIT self-host as the exit | US + EU; hybrid/self-host is Enterprise only | US / EU; self-host is Enterprise only | Self-host keeps all data ours | Local |
| Lock-in | Low: OTLP in, MIT code. Owned by ClickHouse since Jan 2026, which pledged to keep it open ([announcement](https://clickhouse.com/blog/clickhouse-acquires-langfuse-open-source-llm-observability)) | Medium (proprietary SaaS) | Medium (proprietary SaaS; LangChain-centric) | Low (ELv2, not OSI-open) | Low, but owned by OpenAI since Mar 2026 and repositioned as security tooling ([OpenAI](https://openai.com/index/openai-to-acquire-promptfoo/)) |

**OpenTelemetry GenAI conventions as the neutral layer: yes, but only as the wire format.**
- The spec is still **Development** status, and it moved to its own repo in 2026 ([spec](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md)). Attribute names may still change.
- All four backends read `gen_ai.*` attributes today.
- So: use `gen_ai.operation.name` (`chat` / `execute_tool` / `invoke_agent`), `gen_ai.request.model` and `gen_ai.usage.*`. Put our own fields under `maya.*`: purpose, creator hash, cost, failureKind.
- Skip the OTel JS SDK. It adds Node dependencies and gives us nothing a 60-line exporter doesn't.

### 2b. Would an agent framework fix what keeps breaking? No.

What each one offers for an agent that serves one person for months, and what we already have:

| Framework | What it offers | What we have instead |
|---|---|---|
| LangGraph | Checkpointers (thread state) plus a cross-thread `Store` for long-term memory ([docs](https://docs.langchain.com/oss/python/langgraph/persistence)) | Convex rows, transactional and reactive, which is stronger |
| Google ADK | Vertex **Memory Bank**: Gemini pulls memories out of conversations in the background ([Google](https://cloud.google.com/blog/products/ai-machine-learning/vertex-ai-memory-bank-in-public-preview)) | `personalRecords` with sources, taste/performance split and forgetting. We built this, and it's more explicit |
| OpenAI Agents SDK | Sessions (chat-history memory). Durable execution only when paired with Temporal ([Temporal](https://docs.temporal.io/develop/python/integrations/openai-agents)) | The Convex scheduler, and `@convex-dev/workflow` if we need durable steps ([docs](https://docs.convex.dev/agents/workflows)) |
| Claude Agent SDK | Built to run as a *long-lived process in a container* ([hosting](https://code.claude.com/docs/en/agent-sdk/hosting)) | Our shape is thousands of short actions with a 10-minute limit, the opposite |

None of them touches the three bug classes we actually hit:
1. **Data shapes at vendor boundaries.** The fix is validators at `convex/integrations/*` plus recorded fixtures.
2. **A critic that forces an invented answer.** That is a judgment design flaw. `converse.ts` rewrites and never blocks. A framework "guardrail" is the same pattern under a new name.
3. **A judge that truncates its input.** That's our own code; see below.

Tracing is what makes all three visible, and that is the case for this spike.

### Two concrete judge defects found while reading (worth fixing with or without a tool)

- **`expertBench.ts` `judgeCorrectness` cuts off the facts it needs.** It builds `JSON.stringify({ toolsUsed, factsSheHad }).slice(0, 30000)`. `factsSheHad` is serialized **last**, so on tool-heavy turns the ground truth gets cut first. The judge then marks her true numbers as "invented", and the cut JSON is malformed too. Tool results in the trace are also capped at 800 characters (`TRACE_RESULT_CAP`), so a number past 800 characters in a lookup looks invented.
- **The judge is `REGISTRY.critic`**, the same DeepSeek model that critiques her live replies. The bench therefore grades the critic with the critic's own blind spots.

## 3. Integration plan (Langfuse)

**Files that change**

| File | Change |
|---|---|
| `convex/integrations/langfuse/otlp.ts` (new, default runtime) | `exportSpans(spans[])`: OTLP/HTTP-JSON POST to `https://cloud.langfuse.com/api/public/otel/v1/traces`, Basic auth from `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`, 3 s timeout. Never throws, same contract as `callModel`. Also `redact()`: creatorId becomes an HMAC, and personal fields are trimmed to N characters |
| `convex/observability/export.ts` (new) | `internalAction` `flush({spans})`. Callers hand it spans with `ctx.scheduler.runAfter(0, …)`, so export adds **no latency to the reply** and needs **no new table** (the schema is at the TS ceiling) |
| `convex/core/llm.ts` | Optional `trace?: {traceId, parentId}` on `CallModelInput`. After the existing `costs.record`, schedule one `chat` span carrying model, tokens, cost, latency, `maya.purpose`, `succeeded` / `failureKind`, input/output messages, and a `maya.truncated` flag |
| `convex/agent/converse.ts` | Root `invoke_agent` span per inbound message. **traceId = hash(messageId)**, so spans from separate actions join without threading context. Critic verdict as a span. Scores `critic_rewrote` (bool) and `critic_skipped` (bool). The draft and the rewrite are both kept, so "critic forced an invention" becomes a filter plus a diff |
| `convex/agent/investigate.ts`, `tools.ts` | Pass `trace` to `callModel`. `runTool` emits an `execute_tool` span from each `ToolCallRecord`: tool, params, credits, ms, ok, result |
| `convex/eval/expertBench.ts` | `step` writes each case as a Langfuse dataset-run item with scores `pass`, `false_claims`, `correct`, `judge_agree`. Fix the truncation (per-section budgets; never slice JSON). Judge panel, below |
| `scripts/bench/sync-dataset.mjs` (new) | Upserts `EXPERT_CASES` into dataset `expert-bench`: item id = case id; expected output = acceptable / mustNotClaim / requiresQuestion / safety; metadata = labelStatus, persona. Runs on merge. **The repo stays the source of truth**, and Langfuse's dataset timestamps are the version pin |
| `scripts/bench/gate.mjs` + `.github/workflows/bench.yml` (new) | See the CI gate below |

**CI gate (`bench.yml`)**
- Triggers on PRs touching `convex/agent/**`, prompts or `registry.ts`.
- Pushes to a **dedicated eval dev deployment** with a deploy key. Never the bare `npx convex deploy`.
- Starts the bench, polls `scorecard`, and pushes the results as a Langfuse experiment.
- **Fails if either:** any *signed* case has a false claim, or the pass rate falls more than the `gate.ts` tolerance below the last `main` run.
- The run time has to change first. Today `STEP_BEAT_MS` is 4 minutes, so 50 cases take about 3.3 hours. Fan out 8 at a time to get ~25 minutes.

**Making the judge reliable, in order of payoff**
1. **Fix the input** (the truncation above) and record `judge_input_truncated` as a score. Several of the "misreads" are likely this.
2. **Split the hard gate into steps.** One call pulls out every factual claim (number, date, event, cause). A second call checks each claim against `factsSheHad` + tool results → supported / unsupported. That replaces one holistic JSON verdict with a list we can audit.
3. **Use a panel of three judge families, none of them the critic's.** For example GLM, Gemini-Pro-class and GPT/Claude-class. A false claim counts only on a **majority**. A split verdict goes to a stronger model *and* to the annotation queue. This is ~150 judge calls per run, under $1 at current flash prices (verify on OpenRouter).
4. **Calibrate against the operator.**
   - He signs the ~40 labels in a Langfuse **annotation queue** as score `human_pass`.
   - Score analytics then gives kappa between `human_pass` and `judge_pass`.
   - **The gate becomes blocking only at kappa ≥ 0.7.**
   - Every judge prompt change gets re-checked against these same 40 labels.

**Effort and cost**
- Effort (build days):
  - Exporter + `callModel`/tool/critic spans: 2 days
  - Dataset sync + experiment + CI workflow + fan-out: 2 days
  - Judge fix + claim split + panel: 1.5 days
  - Annotation queue + calibration: 0.5 day, plus ~2 hours of the operator's time
  - **Total ≈ 6 days**
- Monthly cost:
  - Langfuse Core ≈ **$50**
  - Pro ($219) if we want 3-year retention or unlimited queues
  - Bench runs: ~$1 of judge calls each, plus the writer's calls and ScrapeCreators credits for the cases' lookups (the bench reads live today, not recorded fixtures)

## 4. Risks, and the 1-day hands-on spike

**Risks**
- **Personal data leaves our stack.** Creator messages would go to a sub-processor. We need a DPA, the EU region and redaction at the exporter, and possibly body-free traces for real creators (bodies only for eval clones). We need to decide which.
- **Scheduler fan-out.** One extra scheduled action per model call is about 6k/day. Watch the Convex function-call bill; batch per turn if needed.
- **Acquirer drift** (ClickHouse). The MIT self-host plus OTLP is the exit.
- **An immature spec.** The GenAI attribute names may still change.
- **The biggest one: a green gate becomes the new "tests passed".** The live check at the end of each sprint stays mandatory.

**What the 1-day spike verifies (go/no-go)**
1. From a default-runtime Convex action on the *local dev* deployment, a hand-built OTLP/JSON POST shows up in Langfuse EU with model, tokens and cost parsed from the `gen_ai.*` attributes. Check the OTLP body size limit.
2. Three spans from three separate actions nest under one trace via the `hash(messageId)` traceId.
3. `@langfuse/client` (datasets/scores) imports in the default runtime. If it doesn't, the fallback is plain REST from a script.
4. Push 10 `EXPERT_CASES`, run them, and see the per-case scores and the run comparison in the UI.
5. `experiment-action` with a JS/TS experiment (the docs example is Python) fails a dummy PR below the threshold.
6. Send 5 bench items to an annotation queue, label them, and confirm score analytics reports kappa.
7. Read the DPA and sub-processor list, and confirm the EU data location.

## 5. Sources
- Langfuse: [pricing](https://langfuse.com/pricing) · [OTel endpoint](https://langfuse.com/docs/opentelemetry/get-started) · [TS SDK](https://langfuse.com/docs/observability/sdk/typescript/overview) · [experiments SDK](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk) · [CI/CD](https://langfuse.com/docs/evaluation/experiments/experiments-ci-cd) · [LLM-as-judge](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge) · [score analytics](https://langfuse.com/docs/evaluation/evaluation-methods/score-analytics) · [self-hosting](https://langfuse.com/self-hosting) · [MIT open-sourcing](https://langfuse.com/blog/2025-06-04-open-sourcing-langfuse-product) · [ClickHouse acquisition](https://clickhouse.com/blog/clickhouse-acquires-langfuse-open-source-llm-observability)
- Braintrust: [pricing](https://www.braintrust.dev/pricing) · [OTel](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry) · [eval-action](https://github.com/braintrustdata/eval-action)
- LangSmith: [pricing](https://www.langchain.com/pricing) · [OTel](https://docs.langchain.com/langsmith/trace-with-opentelemetry)
- Phoenix / Arize: [license](https://arize.com/docs/phoenix/self-hosting/license) · [pricing](https://arize.com/pricing/)
- Promptfoo: [GitHub Action](https://www.promptfoo.dev/docs/integrations/github-action/) · [OpenAI acquisition](https://openai.com/index/openai-to-acquire-promptfoo/)
- OpenTelemetry: [GenAI conventions repo](https://github.com/open-telemetry/semantic-conventions-genai) · [GenAI spans (Development)](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md)
- Convex: [runtimes](https://docs.convex.dev/functions/runtimes) · [workflows](https://docs.convex.dev/agents/workflows)
- Frameworks: [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence) · [ADK memory](https://google.github.io/adk-docs/sessions/memory/) · [Vertex Memory Bank](https://cloud.google.com/blog/products/ai-machine-learning/vertex-ai-memory-bank-in-public-preview) · [OpenAI Agents SDK sessions](https://openai.github.io/openai-agents-js/guides/sessions/) · [Temporal + OpenAI Agents](https://docs.temporal.io/develop/python/integrations/openai-agents) · [Claude Agent SDK hosting](https://code.claude.com/docs/en/agent-sdk/hosting)
- Judge reliability background: [Arize, human-LLM judge alignment](https://arize.com/blog/measuring-human-llm-judge-alignment/)
