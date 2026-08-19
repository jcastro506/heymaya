# Mission Control → v2

**Scoping pass, 2026-08-19.** Not a build. Every `gtmMaya.*` call Mission
Control makes, and what it becomes.

## Why this exists

`convex/maya/` replaced `convex/gtmMaya/` from the database up and **the web
surface was never migrated**. Measured across every screen:

| Screen | v1 calls | v2 calls |
|---|---|---|
| Today | **12** | 2 |
| Account | **7** | 0 |
| Results | **6** | 2 |
| Brain | **3** | 0 |
| Activity | **3** | 0 |
| Settings | **3** | 1 |
| House Rules | 0 | **2** |
| Plan | 0 | **1** |
| **Total** | **34** | **8** |

**~19% migrated**, and the split is not random: House Rules and Plan are the two
screens *built during the clean-sheet rebuild*. Every screen inherited from v1
kept its v1 queries. The rebuild went bottom-up and stopped below the UI.

⚠️ **The consequence is not cosmetic.** A founder signing up today gets a real
v2 Maya writing to `convex/maya/` tables, and Today reads twelve queries' worth
of a deleted product. The dashboard shows the wrong product's data.

## The map

✅ = a v2 equivalent exists · ❌ = has to be written

### Today (12)
| v1 | v2 | |
|---|---|---|
| `missionControl.getMyAgentActivity` | `archive.myActivity` | ✅ |
| `planDoc.getMyPlanDoc` | `strategy.planScreen` | ✅ |
| `postResults.getMyRecentPostResults` | `dashboard.resultsLadder` | ✅ |
| `zernioConnect.getMyConnectedAccounts` | `channels.myChannels` | ✅ |
| `missionActions.getMyConnectionHealth` | `channels.myChannels` (carries status + notices) | ✅ |
| `researchLifecycle.getMyGtmSnapshot` | `dashboard.myDashboard` | ✅ partial |
| `missionActions.getMyDraftQueue` | — | ❌ |
| `missionActions.approveMyDraft` | — | ❌ |
| `missionActions.passOnMyDraft` | — | ❌ |
| `missionActions.requestDraftTweak` | — | ❌ |
| `planDoc.approveMyPlan` | — | ❌ |
| `calendarWrite.getMyCalendarEvents` | — | ❌ |

### Results (6)
| v1 | v2 | |
|---|---|---|
| `missionControl.getMyConversions` | `attribution.myResults` | ✅ |
| `missionControl.getMyPostAttribution` | `attribution.myResults` | ✅ |
| `postResults.getMyRecentPostResults` | `dashboard.resultsLadder` | ✅ |
| `researchLifecycle.getMyGtmSnapshot` | `dashboard.myDashboard` | ✅ |
| `missionActions.getMyDraftQueue` | — | ❌ (same as Today) |
| `missionActions.reportMyConversion` | — | ❌ |

### Brain (3)
| v1 | v2 | |
|---|---|---|
| `researchLifecycle.getMyGtmSnapshot` | `dashboard.myDashboard` | ✅ |
| `missionControl.getMyFoundationInsights` | `dashboard.myIdeaBank` | ✅ *(written 2026-08-18, no consumer yet)* |
| `missionControl.getMyCompetitiveMap` | — | ❌ |

### Activity (3)
| v1 | v2 | |
|---|---|---|
| `missionControl.getMyAgentActivity` | `archive.myActivity` | ✅ |
| `researchLifecycle.getMyGtmSnapshot` | `dashboard.myDashboard` | ✅ |
| `missionControl.getMyMayaMessages` | — | ❌ |

### Account (7)
| v1 | v2 | |
|---|---|---|
| `zernioConnect.getMyConnectedAccounts` | `channels.myChannels` | ✅ |
| `zernioConnect.getZernioConnectUrl` | `connect.startConnect` | ✅ |
| `zernioConnect.refreshMyZernioHealth` | `connect.refreshMyChannels` | ✅ |
| `researchLifecycle.updateProductContext` | `productTruth.correct` | ✅ |
| `researchLifecycle.setMyPostingMode` | — | ❌ |
| `zernioConnect.disconnectZernioAccount` | — | ❌ |
| `zernioConnect.getMyConnectCap` | — | ❌ |

### Settings (3)
| v1 | v2 | |
|---|---|---|
| `missionControl.getMyAccount` | `setup.myState` | ✅ partial |
| `accountLifecycle.cancelMyGtmSubscription` | — | ❌ billing |
| `accountLifecycle.resumeMyGtmSubscription` | — | ❌ billing |

## What this costs

**~13 swap, ~13 to write.** Roughly half is a find-and-replace with shape
adjustment; the other half is new public queries over tables that already hold
the data.

**The biggest single cluster is drafts** — queue, approve, pass, tweak. Four
calls, and they are the "Needs you" tray, which is the whole of Today. Nothing
public reads `drafts` in v2 at all. Do this cluster first: it is the largest
share of one screen and the only interactive thing on it.

⚠️ **Billing is the one genuinely risky group.** `cancelMyGtmSubscription` /
`resumeMyGtmSubscription` touch Stripe on the FROZEN side. Swapping those needs
the v2 billing path verified end to end first — and the Stripe webhook has a
history here: it was never public and would have eaten the first real payment.

⚠️ **Two v2 queries already exist with no consumer** — `dashboard.myIdeaBank`
and `dashboard.myMediaLibrary`, written 2026-08-18. Wire them while migrating
Brain and the assets view rather than leaving them as the same
built-but-unconnected defect this document is about.

## Order

1. **Drafts cluster** (4) — unblocks Today's only interaction
2. **Today's six swappable calls** — the screen a founder lands on
3. **Brain + Activity** — small, mostly swaps, and Brain gets `myIdeaBank`
4. **Results** — two swaps plus `reportMyConversion`
5. **Account** — four swaps plus three to write
6. **Settings/billing** — last, and only after the v2 Stripe path is proven live
