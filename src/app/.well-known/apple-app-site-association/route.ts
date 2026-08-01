// Activates iOS Universal Links for invite URLs (sparkletapp.com/invite/[refId])
// — the iOS client (sparklet-ios repo)'s applinks:sparkletapp.com entitlement
// and RootView.onContinueUserActivity(.browsingWeb) handler have been wired
// and waiting on this file since DEVELOPMENT_TEAM was set there. Served as a
// Route Handler rather than a static public/ file so the response is
// guaranteed application/json regardless of host/CDN static-file defaults —
// Apple's CDN fetches this over HTTPS with no extension and is strict about
// content type. appID is "<Apple Developer Team ID>.<bundle ID>"; only
// /invite/* opens the app — every other route (feed, profile, terms, etc.)
// should keep opening in Safari, matching what AGENTS.md (sparklet-ios repo)
// documents as already-built app-side behavior.
export async function GET() {
  return Response.json(
    {
      applinks: {
        apps: [],
        details: [
          {
            appID: "K4JYC7UP3A.com.sparklet.ios",
            paths: ["/invite/*"],
          },
        ],
      },
    },
    { headers: { "Content-Type": "application/json" } }
  );
}
