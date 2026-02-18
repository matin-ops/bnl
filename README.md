# Contact form hardening

This project now sends contact form submissions to an internal backend endpoint (`/api/contact`) instead of calling n8n directly from the browser.

## Required environment variables

Set these in your deployment platform:

- `N8N_WEBHOOK_URL` → **production** n8n webhook URL (use `/webhook/...`, not `/webhook-test/...`)
- `N8N_WEBHOOK_SECRET` → shared secret that the backend sends as `X-Webhook-Secret`
- `ALLOWED_ORIGIN` (optional) → exact frontend origin, e.g. `https://example.com`

## n8n setup

1. In your workflow, use a **production webhook** trigger path (`/webhook/...`) and activate the workflow.
2. Add a validation step early in the workflow to verify `X-Webhook-Secret` matches your configured secret.
3. Reject requests with missing/invalid secret before processing business logic.

## Abuse detection and monitoring

The backend logs structured events for:

- rate-limit blocks,
- bot-protection hits,
- validation failures,
- upstream n8n failures,
- successful forwards.

Use platform logs/alerts on warning/error entries to detect suspicious traffic and delivery failures quickly.
