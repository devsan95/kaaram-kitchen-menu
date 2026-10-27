# Kaaram Kitchen: digital menu

Static page (`public/index.html`) + three small Vercel serverless functions (`api/`).
Guests see the menu; staff sign in with HTTP Basic Auth at `/admin` to edit the menu and run the kitchen display.

## Deploy on Vercel
1. Import this GitHub repo in Vercel (framework preset: **Other**, no build command, output directory: `public`).
2. **Settings → Environment Variables**: add `KAARAM_USER` and `KAARAM_PASS` (a long random password). There is no default login: if these are unset, nobody can sign in.
3. **Storage → Marketplace → Upstash Redis** (free tier) → connect to the project. This sets `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`) automatically. It stores the published menu; without it, Publish returns "storage isn't set up".
4. Redeploy. Open `https://<your-site>/admin`.

Vercel serves everything over HTTPS, so Basic Auth credentials are protected in transit.

## Notes
- Table orders and the kitchen display are still per-browser (demo): they use localStorage, not the server.
- `index.html` opened straight from disk (file://) falls back to a local-only login (`admin` / `kaaram@123`); that fallback is not used on the deployed site.
