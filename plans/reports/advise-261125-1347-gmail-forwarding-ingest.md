# Decision: replace Gmail app password / IMAP with email forwarding

Date: 2026-11-25. Accepted by the user via `/ak-advise`; applied to `plans/261125-0632-spendsync-port-elysia-react`.

## Decision

Users no longer give the app a Google app password. Each user gets a unique, unguessable inbound address (`<token>@in.<domain>`), creates a Gmail filter that forwards emails from the supported bank senders to it, and Cloudflare Email Routing + an Email Worker pushes the raw MIME to the Elysia server. Old emails are imported by uploading `.eml` / `.mbox` files.

| Question | Answer |
| --- | --- |
| History (forwarding only carries new mail) | Upload `.eml` / `.mbox` (Google Takeout of a label). No IMAP at all |
| Inbound receiver | Cloudflare Email Routing + Email Worker → HMAC-signed POST to the server |
| Mail without a valid bank DKIM signature | Keep and parse it, mark the transaction unverified, exclude it from totals and reports until the user confirms it |

## Evidence gathered

- DNS on 2026-11-25: `_dmarc.info.vietcombank.com.vn` is `p=reject`, `_dmarc.cake.vn` is `p=quarantine`, `_dmarc.vpb.com.vn` is `p=none`. All three send through Exchange Online per SPF.
- Forwarded mail always fails SPF (it leaves Google's servers), so the bank's DKIM signature is the only proof of origin.
- Upstream fixtures have their headers stripped, so DKIM presence could not be checked from them.

## Rules the implementation must follow

1. A DKIM signature counts only when it passes, its `d=` equals the From domain or a parent of it, and it either has no `l=` tag or `l=` covers the whole body. The From address must be a configured bank sender. Cloudflare's own authentication results are ignored.
2. Non-bank mail is accepted and discarded without storing the body; it is never bounced. Mail to an unknown or replaced address is rejected.
3. The server never fetches links found in inbound mail. The Gmail forwarding confirmation code and link are shown to the user, who confirms in Gmail.
4. Uploaded files skip the DKIM gate (old DKIM keys rotate; uploaders can only affect their own data).
5. The Worker never stores or logs message content.

## Unverified at decision time

| Assumption | How to confirm |
| --- | --- |
| VCB, CAKE and VPB sign with DKIM and the signature survives Gmail forwarding | Verify a real forwarded email per bank with `mailauth` (first task of phase 4) |
| Gmail keeps `Message-ID` on auto-forward | Inspect a real forwarded email |
| Cloudflare returns a temporary failure (so Gmail retries) when the Worker throws | Cloudflare Email Workers docs, then a test |
| Email Routing works on a subdomain such as `in.<domain>` | Cloudflare docs; otherwise use a dedicated domain |
| Importing a Gmail filter `.xml` keeps the forward action | Try it on a real Gmail account |
| `mailauth` 8.1.0 runs on Bun | Small test in phase 4 |
