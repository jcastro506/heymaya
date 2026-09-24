/**
 * Universal links for the Maya iOS app (app spec §2, §6.7): /o/<kind>/<id> and the legacy
 * /app/<tab> links in older messages open the app when it's installed. APPLE_TEAM_ID is the
 * operator's Apple team; without it this answers 404 rather than a file that can't match.
 */
export function GET() {
  const team = process.env.APPLE_TEAM_ID;
  if (!team) return new Response("not configured", { status: 404 });
  const body = {
    applinks: {
      details: [{ appIDs: [`${team}.ai.heymaya.maya`], components: [{ "/": "/o/*" }, { "/": "/app/*" }] }],
    },
  };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
