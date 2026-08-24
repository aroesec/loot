# Notifications

The app ships a manifest and installs to a Home Screen or Dock. On iOS that is
not cosmetic: **Safari withholds the notification API entirely until a site is
installed**, so alerts cannot be enabled from a normal tab no matter what
permissions are granted. Add to Home Screen, open it from the new icon, then
turn alerts on in Settings. The toggle detects this case and walks through it
rather than reporting the browser as unsupported.

Requires iOS 16.4 or later, which is where Safari gained web push at all.

Icons are rendered from the theme's accent color rather than committed as fixed
artwork, so a fork that changes the palette gets its own icon from
`pnpm icons` instead of inheriting this one's green.

## Channels

Push and SMS are peers. Both are off until configured, and silence is a valid
outcome for a run.

| Channel | Needs |
|---|---|
| Web Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (`pnpm push:keys`) |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `ALERT_PHONE` |

Adding a channel (email, ntfy, Slack) means registering one object. See
[extending.md](extending.md).

## What gets sent

Three rules, in `src/lib/notify/alerts.ts`: only what is actionable or
surprising, once per logical event rather than once per run, and nothing at all
when there is nothing to say. Thresholds come from the household's own history,
so a large charge is a multiple of their median transaction rather than a fixed
number.

SMS costs money per message, which is a good reason to keep that bar high.
