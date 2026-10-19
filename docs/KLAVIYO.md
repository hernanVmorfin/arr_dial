# Comfort Dial: Klaviyo reminder flow

Each win sends Klaviyo a **Comfort Dial Won** event. When the CSR sets Code status to Redeemed in Monday (or someone
marks it redeemed in the admin), the app sends **Comfort Dial Redeemed**. A code voided in the admin sends
**Comfort Dial Voided**. The flow reminds winners at day 7 and day 25 and stops once they've redeemed or been
voided.

Reminder texts go only to winners who ticked "Also text me a reminder…" on the claim screen. That box is the SMS
marketing consent; the app records it in Klaviyo with a subscription job (source "Comfort Dial"). The code itself is
texted by Podium for everyone who claims, consent or not.

## Event properties

Use these in message templates as `{{ event.<name> }}`:

| Property | Example |
|---|---|
| `code` | ARR-7K3P |
| `gift_name` | $20 off any service |
| `gift_short` | $20 OFF |
| `gift_value` | 20 |
| `expires_on` | November 15 |
| `expires_at` | 2026-11-15T15:00:00.000Z |
| `reminders_opt_in` | true |
| `phone_display` | (708) 671-0813 |
| `utm_source`, `utm_campaign`, … | when the visit had them |

## Build the flow

Do this after the launch test (RUNBOOK step 8) has sent the first event, so the metric exists.

1. Flows → Create flow → Build your own. Name it **Comfort Dial reminders**.
2. **Trigger**: Metric → **Comfort Dial Won**.
3. **Flow filter**: "What someone has done (or not done)" → **Comfort Dial Redeemed** → zero times → since starting
   this flow, **AND** **Comfort Dial Voided** → zero times → since starting this flow. Anyone who redeems, or whose
   code is voided, exits before the next message. (The Voided metric appears in Klaviyo after the first void; add
   the second condition then.)
4. **Time delay**: 7 days.
5. **SMS**, day 7:

   > Always Ready Repair: your Comfort Dial gift ({{ event.gift_short }}) is still waiting. Code {{ event.code }},
   > good through {{ event.expires_on }}. Call or text (708) 671-0813 to book.

6. **Time delay**: 18 days (day 25).
7. **SMS**, day 25:

   > Always Ready Repair: your {{ event.gift_short }} code {{ event.code }} expires {{ event.expires_on }}. Call or
   > text (708) 671-0813 to use it before then.

8. Both messages: Smart Sending **off** (these are one-off reminders tied to a code), quiet hours **on**. Klaviyo
   appends the account's opt-out line ("Text STOP to opt-out").
9. Preview with a test profile, then set the flow **Live**.

Both texts send people to the office number, so replies and calls land where CSRs work, not in Klaviyo's inbox.

## Optional

- **Email version**: the dial doesn't collect email, so this flow is SMS only. If an email field is ever added, add
  matching email steps after each delay.
- **Segment for reporting**: "What someone has done: Comfort Dial Won at least once" and, inside it, "Comfort Dial
  Redeemed at least once" give the redemption rate.
