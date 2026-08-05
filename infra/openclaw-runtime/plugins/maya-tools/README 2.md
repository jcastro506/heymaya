# maya-tools

The OpenClaw tool plugin for the `convex/maya` agent (§18 Sprint 3).

Three tools — `publish`, `reply`, `ask_founder` — each a schema-validated call
to a `/maya/*` route on Convex. It is the transport half of the pack; the
guarantees live server-side in `convex/maya/hooks.ts`.

## Environment

| Variable | What |
|---|---|
| `CONVEX_SITE_URL` | Convex HTTP surface (falls back to `CONVEX_URL`) |
| `MAYA_AGENT_TOKEN` | This customer's agent token. The server stores only its SHA-256. |

`MAYA_AGENT_TOKEN` is deliberately **not** `HOOK_TOKEN`. That belongs to the
frozen v1 pack, and a machine mid-migration can carry both — separate name,
separate credential, separate blast radius.

A missing variable produces a named envelope failure telling the model to stop,
never a thrown error and never silence.

## Two properties that must survive every edit

**1. No tool accepts a `customerId`.** Tenancy resolves server-side from the
bearer token alone. A tenant parameter here would hand the model the ability to
name an account it isn't, re-opening the class of bug the server surface was
shaped to eliminate. Asserted by a test.

**2. The envelope passes through verbatim.** The server answers
`{ok, data, next, why}` and the model needs all four — especially `next`, which
is what stops it retrying a decision that will never change. A tool that returns
only `data` silently deletes the choreography. Also asserted.

## `ok: false` is often not an error

A held post is a real answer. `data.holdReason` names which of the four
legitimate reasons applies, and `next` says to relay it rather than retry. The
same is true of `ask_founder` refusing a second question while one is open.

## Not yet verified live

The plugin has never been loaded by a running OpenClaw machine — there isn't one
deployed. What is verified is the source contract: the manifest matches the
registered tools, no schema carries a tenant id, and every transport path
returns an envelope. **That the model actually calls these and gets rows back is
the Sprint 3 exit criterion, and it is not demonstrated yet.**
