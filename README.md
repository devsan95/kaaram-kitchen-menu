# Kaaram Kitchen: digital menu

Static page (`public/index.html`) + four small Vercel serverless functions (menu, auth, admin, orders) (`api/`).
Guests see the menu; staff sign in with HTTP Basic Auth at `/admin` to edit the menu and run the kitchen display.

## Deploy on Vercel
1. Import this GitHub repo in Vercel (framework preset: **Other**, no build command, output directory: `public`).
2. **Settings → Environment Variables**: add `KAARAM_USER` and `KAARAM_PASS` (a long random password). There is no default login: if these are unset, nobody can sign in.
3. **Storage → Marketplace → Upstash Redis** (free tier) → connect to the project. This sets `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`) automatically. It stores the published menu; without it, Publish returns "storage isn't set up".
4. Redeploy. Open `https://<your-site>/admin`.

Vercel serves everything over HTTPS, so Basic Auth credentials are protected in transit.

## How orders work
- A guest's phone sends the order to `/api/orders`; the kitchen tablet (signed in at `/admin`, **Kitchen** tab) polls every 3 seconds, chimes on new tickets, and each bump (new, cooking, ready, served) is saved on the server.
- Guests see their order's status update on their own phone, including after a page reload.
- Guests can only read the status of the order numbers they hold; the full ticket list needs the staff login. Orders are rate-limited (12 per minute per IP) and served tickets are removed after 3 hours.
- This needs the Upstash Redis storage from step 3. Without it the page falls back to the old single-browser demo.

## Notes
- `index.html` opened straight from disk (file://) falls back to a local-only login (`admin` / `kaaram@123`); that fallback is not used on the deployed site.
