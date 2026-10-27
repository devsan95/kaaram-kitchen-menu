# Kaaram Kitchen: digital menu

Static page (`public/index.html`) + four small Vercel serverless functions (menu, auth, admin, orders) (`api/`).
Guests land on a home page with three options (Dine in, Takeaway, Delivery); staff sign in with HTTP Basic Auth to edit the menu, run the kitchen display and the rider screen.

## Pages
| Address | Who | What |
|---|---|---|
| `/` | guests | Home: **Dine in**, **Takeaway** or **Delivery** (the QR code on the door or flyer points here) |
| `/table/7` | guests | Dine in at table 7. Put one QR code per table. Old `/#table7` links redirect here |
| `/takeaway` | guests | Order ahead, collect from the counter. Asks for name and phone. Pay when you collect |
| `/delivery` | guests | Home delivery. Asks for name, phone, address and Google Maps location. Pay cash or UPI on delivery |
| `/admin` | staff | Menu editor (also `/admin/preview` for the guest view) |
| `/kitchen` | staff | Kitchen display: all three order types |
| `/rider` | staff or rider | Delivery run sheet |

Every screen has its own address, so refresh, back, forward and bookmarks work.

## Deploy on Vercel
1. Import this GitHub repo in Vercel (framework preset: **Other**, no build command, output directory: `public`).
2. **Settings → Environment Variables**: add `KAARAM_USER` and `KAARAM_PASS` (a long random password). There is no default login: if these are unset, nobody can sign in.
3. **Storage → Marketplace → Upstash Redis** (free tier) → connect to the project. This sets `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`) automatically. It stores the published menu; without it, Publish returns "storage isn't set up".
4. Redeploy. Open `https://<your-site>/admin`. Print one QR code per table pointing at `https://<your-site>/table/<number>`, and one for the home page `https://<your-site>/`.

Vercel serves everything over HTTPS, so Basic Auth credentials are protected in transit.

## How orders work
- A guest's phone sends the order to `/api/orders`; the kitchen tablet (signed in at `/admin`, **Kitchen** tab) polls every 3 seconds, chimes on new tickets, and each bump (new, cooking, ready, served) is saved on the server.
- Guests see their order's status update on their own phone, including after a page reload.
- Guests can only read the status of the order numbers they hold; the full ticket list needs the staff login. Orders are rate-limited (12 per minute per IP) and served tickets are removed after 3 hours.
- This needs the Upstash Redis storage from step 3. Without it the page falls back to the old single-browser demo.

## Notes
- `index.html` opened straight from disk (file://) falls back to a local-only login (`admin` / `kaaram@123`); that fallback is not used on the deployed site.

## Printing bills
- Guests: **Ask for bill → Print**. Staff: receipt icon on a table card in the Kitchen tab (By table view).
- Kitchen tab → **Test print** prints a sample bill without placing an order. Use it the first time a printer is connected.
- Receipt printer (80 mm): choose the 80 mm paper size, margins "None", turn off headers/footers. Normal printer: A4. Printing to "Save as PDF" also works.

## Takeaway (collect) and delivery
- **Takeaway**: `/takeaway`. Name and phone only. Tracker: Received, Cooking, Ready to collect, Collected. The kitchen buttons are Start cooking, Mark ready, Handed over.
- **Delivery**: `/delivery`. The guest picks dishes, taps Checkout, and enters name, phone, delivery address and a Google Maps location (pasted link, or "Use my current location"). Tracker: Received, Cooking, Packed, On its way, Delivered.
- Validation runs in the page and again on the server (`api/orders.js`): Indian or international phone number, address of at least 10 characters, and only Google Maps links or plain `lat,lng` are accepted.
- The kitchen tab shows each takeaway and delivery as its own card (labelled TA or DL) with the customer's name, a tap-to-call phone link, the address and an "Open in Google Maps" link. Delivery steps are New, Cooking, Packed, Dispatched. Print bill includes the customer's details.
- Payment is cash or UPI on delivery. There is no delivery fee or distance check yet.
- Customer details are stored in Redis with the order and removed with it (3 hours after dispatch, or 12 hours at the latest). Guests can only read the status of their own order numbers.

## Rider screen
- Open `https://<your-site>/rider` (it used to be `/delivery`, which is now the customer page). The browser asks for a login. Staff can use their normal login; riders use their own.
- Optional rider login: set `KAARAM_RIDER_USER` and `KAARAM_RIDER_PASS` in Vercel. A rider can only see the delivery screen: packed delivery orders with the customer's name, phone, address, a Navigate link and the amount to collect. They cannot open the menu editor or the kitchen feed.
- Flow: the kitchen marks an order **Packed** → it appears under *Ready for pickup* (with a chime) → rider taps **Picked up** → *On the road* → **Mark delivered**. Delivered orders stay visible for 30 minutes so a mis-tap can be undone.
- The customer's tracker follows along and shows **Delivered** at the end. Staff also have a **Deliveries** tab in the staff bar.
