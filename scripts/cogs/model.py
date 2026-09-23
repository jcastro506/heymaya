"""
Maya creator COGS model (2026-09-23). Every unit cost is either MEASURED from the
creator dev ledger (costEvents, 2026-09-02..23, vendor-reported for OpenRouter) or a
CITED vendor price. Usage frequencies are assumptions, named, and the thing to replace
with pilot data. Run: python3 scripts/cogs/model.py
"""

SC = 0.00188          # ScrapeCreators $/credit ($47 / 25k pack; $497/500k pack = $0.00099)
SC_BULK = 0.00099
TAVILY = 0.008        # $/basic search, PAYG
CLAW_PER_MSG = 0.005  # agency overage $/msg (1,000 included per line)
CLAW_LINE = 199.0     # agency $/line/month
OR_FEE = 0.055        # OpenRouter card top-up fee on model spend

# --- measured per-call costs (ledger, vendor-reported) -------------------------------
converse = 0.00789; converse_rewrite = 0.00943; rewrite_rate = 213 / 661
classify = 0.00021; critic = 0.00019; remember = 0.00038; judge = 0.00019
scout = 0.01057; scout_rewrite = 0.01624
weekly_review = 0.01559; weekly_rewrite = 0.01512
learn_weekly = 0.02085; taste_profile = 0.00385; morning = 0.00609
watch_own = 0.00482   # gemini direct, per own post watched
onboarding_once = 0.35  # measured live 2026-09-02

def per_creator(profile, tier, stage):
    """Monthly variable cost for one creator. stage: 'today' or 'after_B' (brain sprints + app)."""
    accounts = 1 if tier == "solo" else 2
    u = {
        "light":   dict(turns=20,  opinions=2,  moments=0, own_posts=8,  tracked=5, keywords=5, proactive_per_day=1.0),
        "typical": dict(turns=60,  opinions=6,  moments=2, own_posts=17, tracked=6, keywords=8, proactive_per_day=2.0),
        "heavy":   dict(turns=250, opinions=25, moments=6, own_posts=40, tracked=10, keywords=8, proactive_per_day=3.0),
    }[profile]
    if stage == "after_B":
        u = dict(u, opinions=u["opinions"] + {"light": 1, "typical": 4, "heavy": 12}[profile])  # share extension
    c = {}
    turn = converse + rewrite_rate * converse_rewrite + classify + critic * (1 + rewrite_rate) + remember + judge + 2 * SC
    c["replies (model + lookups)"] = u["turns"] * turn
    c["opinions / explain-post"] = u["opinions"] * (0.012 + 0.0045 + 15 * SC)   # writer+critic, gemini watch, ~15 credits
    c["moments (photo/clip)"] = u["moments"] * 0.03
    # proactive: shared fleet reads are divided by an overlap factor (same handle/keyword read once)
    c["lane watching (sampler)"] = u["tracked"] * 4 * 30 * SC * 0.8
    c["lane sweep (keywords)"] = u["keywords"] * 30 * SC * 0.7
    c["own posts readback + watch"] = accounts * 30 * SC + u["own_posts"] * accounts * (watch_own + 0.006)
    c["scout (daily pass)"] = 30 * (scout + 0.2 * scout_rewrite + critic + 15 * SC)
    c["weekly review + learning"] = 4.3 * (weekly_review + 0.5 * weekly_rewrite + learn_weekly + 0.01)
    c["taste + morning + cadence"] = 30 * taste_profile + 20 * morning + 8 * 0.006
    c["memory upkeep"] = (u["turns"] * 2 + 60) * remember * 0.3 + 0.01
    if tier == "partner":
        c["partnerships"] = 20 * (TAVILY + 0.02) + 15 * 0.01
    if stage == "after_B":
        c["diagnoses (why it popped/flopped)"] = {"light": 2, "typical": 6, "heavy": 15}[profile] * (0.03 + 20 * SC + 3 * TAVILY)
    model_share = 0.8  # share of the above billed through OpenRouter (fee applies)
    c["OpenRouter 5.5% top-up fee"] = sum(c.values()) * model_share * OR_FEE
    outbound = u["turns"] * 1.5 + u["proactive_per_day"] * 30
    c["_messages"] = outbound + u["turns"]
    return c

def zernio_per_account(total_accounts):
    """Graduated: 1-2 free, 3-10 $6, 11-100 $3, 101-2000 $1 (zernio.com/pricing, verified 2026-07-02)."""
    bands = [(2, 0), (10, 6), (100, 3), (2000, 1)]
    cost, prev = 0.0, 0
    for top, price in bands:
        n = max(0, min(total_accounts, top) - prev); cost += n * price; prev = top
    return cost / total_accounts

def messaging_per_creator(n_creators, msgs_per_creator, recipients_per_line):
    lines = max(1, -(-n_creators // recipients_per_line))
    total_msgs = n_creators * msgs_per_creator
    overage = max(0, total_msgs - 1000 * lines) * CLAW_PER_MSG
    return (lines * CLAW_LINE + overage) / n_creators

PRICE = {"solo": 19.0, "duo": 24.99, "partner": 29.99}
STRIPE = lambda p: p * 0.029 + 0.30 + p * 0.007   # card + Stripe Billing 0.7%
FIXED = {  # $/month, platform
    "Convex Pro (1 seat) + usage": 25 + 40, "Vercel Pro": 20, "Clerk Pro": 25, "Fly (claw relay)": 5,
    "Sentry Team": 26, "EAS Starter (app builds/OTA)": 19, "Apple Developer ($99/yr)": 8.25,
    "Domain + email": 10, "Google CASA re-assessment (Gmail restricted scope, ~$1.5k/yr, partnerships)": 125,
}

if __name__ == "__main__":
    import json
    mix = {"solo": 0.5, "duo": 0.3, "partner": 0.2}
    for stage in ("today", "after_B"):
        print(f"\n===== {stage} =====")
        for tier in PRICE:
            for prof in ("light", "typical", "heavy"):
                c = per_creator(prof, tier, stage)
                msgs = c.pop("_messages")
                var = sum(c.values())
                print(f"{tier:8} {prof:8} variable ${var:5.2f}  msgs/mo {msgs:4.0f}")
        c = per_creator("typical", "duo", stage); c.pop("_messages")
        print("  breakdown typical duo:", {k: round(v, 3) for k, v in c.items()})
    print("\n===== full margin, typical usage, after_B, by scale =====")
    for n in (50, 200, 1000):
        accounts = int(n * (mix["solo"] * 1 + (mix["duo"] + mix["partner"]) * 2))
        z = zernio_per_account(accounts)
        fixed = sum(FIXED.values()) / n
        for rpl, label in ((10_000, "1 line"), (50, "50 recipients/line")):
            row = []
            for tier in PRICE:
                c = per_creator("typical", tier, "after_B"); msgs = c.pop("_messages")
                var = sum(c.values())
                acc = 1 if tier == "solo" else 2
                cogs = var + z * acc + messaging_per_creator(n, msgs, rpl) + STRIPE(PRICE[tier]) + fixed + onboarding_once / 8 + 0.8
                row.append(f"{tier} ${cogs:5.2f} ({(1 - cogs / PRICE[tier]) * 100:4.0f}%)")
            print(f"n={n:5} zernio ${z:4.2f}/acct fixed ${fixed:5.2f}  msg[{label:18}] ${messaging_per_creator(n, 210, rpl):5.2f} | " + " · ".join(row))
    print("\nworst case proactive at today's cap: $0.75/day x 30 =", 0.75 * 30)
