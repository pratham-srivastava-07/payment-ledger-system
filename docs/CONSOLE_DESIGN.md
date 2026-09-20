# Operations console

Design read: a daily operations tool for backend engineers, with light editorial surfaces, cobalt accents, precise typography and restrained feedback. Design variance 4, motion intensity 3, visual density 6. New frontend; existing API behavior is preserved.

References: https://sift1.vercel.app/ (input/output clarity and rules), https://vynk7.vercel.app/ (technical diagrams and cobalt), https://create-expressive.vercel.app/ (Geist and spacing), https://yashksaini.vercel.app/ (compact technical metadata). These are visual influences, not copied layouts or assets.

Design-taste is explicitly scoped away from dashboards; its applicable typography, palette and accessibility guidance is used. Emil design engineering informs fast feedback, stable layouts, focus behavior and reduced-motion handling. The requested better-ui skill was not installed.

Next.js App Router, TanStack Query for server state, TanStack Table for tabular data, Radix Dialog for focus-managed dialogs, Phosphor icons, self-hosted Geist Sans/Mono. A same-origin Next rewrite proxies `/api` and `/api-docs` to Express (`API_ORIGIN` overrides the default `http://127.0.0.1:3000`). Native CSS tokens establish light/dark themes. Radius: 6px controls, 10px dialogs; flat sections with hairline separators. Layer scale: 10 sticky header, 20 mobile navigation, 40 modal overlay, 50 dialog.

Views: overview, payments, ledger, event delivery and reconciliation. Payment inspection and creation use drawers. Unknown outcomes remain pending, keep their idempotency keys and poll for recovery. All money remains bigint/digit strings; only dimensionless chart ratios become numbers.

A clearly labeled sample workspace is available without a database. It never silently replaces a failed live request. Connecting requires an operator JWT, retained in session storage only, and clears preview caches. Sample operations stay in browser memory. No fake health or invented processor timings are presented as backend telemetry.

No new persistence models are needed. New authenticated read endpoints expose scoped payment listing, expanded payment details, currency-separated overview aggregates and existing system-account balances. Existing payment/refund write contracts are reused.
