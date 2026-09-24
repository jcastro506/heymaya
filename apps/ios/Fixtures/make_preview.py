"""
Builds the Debug preview set (preview.*.json) from REAL captured query outputs, so the
design pass sees realistic states. Contract tests never read these; they read the untouched
captures (today.json, ideas.json, ...). Re-run after re-capturing: python3 make_preview.py

What is adjusted, and why (nothing is invented):
- ideas: the 3 real ideas from the vanessaalopezz persona (real TikTok evidence, so real
  covers) are marked "sent" so the New stack has content, followed by the year-long
  persona's hearted/posted/passed ideas for the other filters.
- today: "what she sent today" is filled with the real texts of those 3 ideas, timestamped
  today, so the section can be designed.
"""
import json, os, random, sys, time

here = os.path.dirname(__file__)
load = lambda p: json.load(open(os.path.join(here, p)))
now = int(time.time() * 1000)


def analytics_a1():
    """A1 cards on the numbers screen (follower growth, From your profile, Who follows you).

    SAMPLE, not captured: no real account is connected yet, so these numbers are made up to
    look like a ~8k Instagram creator and a ~2k TikTok one. Shapes match the server exactly
    (convex/connections/audience.ts appCards). Replace with a capture once a pilot connects.
    Idempotent: overwrites only the A1 keys. Run alone with: python3 make_preview.py analytics
    """
    a = load("preview.analytics.json")
    rnd = random.Random(7)
    day = 86_400_000

    def growth(start, base_gain, spike_at=None):
        days, f = [], start
        for i in range(90):
            d = time.strftime("%Y-%m-%d", time.gmtime((now - (89 - i) * day) / 1000))
            g = base_gain + rnd.randint(-2, 3) + (40 - 6 * (i - spike_at) if spike_at is not None and spike_at <= i < spike_at + 6 else 0)
            l = max(0, rnd.randint(0, 3))
            if i == 0:
                g, l = None, None
            else:
                f += g - l
            days.append({"day": d, "followers": f, "gained": g, "lost": l})
        month = days[-30:]
        return {"days": days, "flowReported": True, "gained30d": sum(x["gained"] or 0 for x in month), "lost30d": sum(x["lost"] or 0 for x in month)}

    for acc in a["accounts"]:
        acc["connected"] = True
        acc["needsReconnect"] = False
        if acc["platform"] == "tiktok":
            g = growth(1850, 4)
            acc.update(growth=g, profile=None, audience=None)
        else:
            g = growth(7600, 8, spike_at=70)
            acc.update(accountType="creator", setup=None, growth=g)
            acc["profile"] = {"status": "ok", "fromDate": g["days"][-30]["day"], "toDate": g["days"][-1]["day"], "asOf": now - 5 * 3_600_000,
                              "profileLinkTaps": 214, "follows": g["gained30d"], "unfollows": g["lost30d"], "reach": 48_300, "accountsEngaged": 2_140}
            acc["audience"] = {"status": "ok", "asOf": now - 2 * day, "followersCounted": 8_050,
                               "gender": [{"label": "Women", "share": 0.71}, {"label": "Men", "share": 0.27}, {"label": "Not specified", "share": 0.02}],
                               "age": [{"label": l, "share": s} for l, s in [("13-17", 0.03), ("18-24", 0.34), ("25-34", 0.41), ("35-44", 0.14), ("45-54", 0.05), ("55-64", 0.02), ("65+", 0.01)]],
                               "countries": [{"label": l, "share": s} for l, s in [("United States", 0.58), ("Mexico", 0.09), ("Canada", 0.06), ("United Kingdom", 0.05), ("Philippines", 0.03)]],
                               "cities": [{"label": l, "share": s} for l, s in [("Los Angeles, California", 0.07), ("Houston, Texas", 0.04), ("New York, New York", 0.04), ("Chicago, Illinois", 0.03), ("San Antonio, Texas", 0.03)]]}
        acc["followers"] = g["days"][-1]["followers"]
        acc["followersAsOf"] = now - 3_600_000
        acc["followers30dAgo"] = g["days"][-31]["followers"]
    json.dump(a, open(os.path.join(here, "preview.analytics.json"), "w"), indent=1)
    print("preview.analytics.json: A1 cards (sample)")


if sys.argv[1:] == ["analytics"]:
    analytics_a1()
    sys.exit(0)

base_ideas = load("ideas.json")
year_ideas = load("year/ideas.json")
ideas = [dict(i, status="sent", sentAt=now - (n + 1) * 3_600_000) for n, i in enumerate(base_ideas)]
for status in ("hearted", "posted", "passed", "expired"):
    ideas += [i for i in year_ideas if i["status"] == status][:6]
ideas[3]["saved"] = True
json.dump(ideas, open(os.path.join(here, "preview.ideas.json"), "w"), indent=1)

today = load("today.json")
today["sentToday"] = [
    {"id": f"m{n}", "kind": "idea", "body": i["messageText"], "links": i["evidenceLinks"], "ts": now - (n + 1) * 3_600_000, "delivered": True, "error": None}
    for n, i in enumerate(base_ideas[:2])
]
json.dump(today, open(os.path.join(here, "preview.today.json"), "w"), indent=1)
print("preview.ideas.json", len(ideas), "· preview.today.json sent", len(today["sentToday"]))
analytics_a1()
