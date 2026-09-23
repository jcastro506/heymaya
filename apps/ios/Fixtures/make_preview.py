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
import json, os, time

here = os.path.dirname(__file__)
load = lambda p: json.load(open(os.path.join(here, p)))
now = int(time.time() * 1000)

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
