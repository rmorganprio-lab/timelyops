# TimelyOps — AI Agent Build Brief

**Web Form + SMS/Phone Versions**

**March 2026 — Confidential**

---

## Purpose of this document

Complete specification for building the TimelyOps AI booking agent, including architecture, conversation flow, Supabase schema, rate limiting, and cost model. Intended for use in a Claude Code build session.

---

## 1. What It Does

One agent, two entry points — web form and SMS/phone — sharing the same backend logic. The agent handles inbound booking inquiries when the owner is unavailable, which is the single biggest revenue leak for a small service business operator.

The agent does four things in sequence:

1. Collects property details from the prospect (bedrooms, bathrooms, clean type, frequency)
2. Looks up the correct price from the org's pricing matrix in Supabase
3. Offers available time slots from the org's schedule
4. Creates a draft job in Supabase and notifies the owner for confirmation

Note: No job is auto-confirmed without owner approval in v1. The owner receives an SMS, replies YES or NO, and the job status updates accordingly.

The agent introduces itself by business name, pulled from the org record. It behaves identically for every TimelyOps customer — the only difference is the org it is scoped to.

---

## 2. Org Architecture — Staying Under timelyops.com

Each business gets a public booking URL scoped to their org slug. No DNS changes, no subdomains, no per-client builds required.

```
timelyops.com/book/hildas-housecleaning
timelyops.com/book/green-leaf-landscaping
timelyops.com/book/splash-pool-service
```

The route parameter maps to an org_slug stored in Supabase. The agent loads the org's name, pricing matrix, and available schedule slots at the start of every conversation. One deployment serves every customer on the platform.

| Element | Detail |
|---------|--------|
| Route | timelyops.com/book/[slug] — public React route, no login required |
| Scoping | org_slug maps to org_id in Supabase; all data queries filter by org_id |
| Branding | Agent greeting pulls business name from the organizations table — no custom build per client |
| Multi-tenancy | Existing RLS policies already enforce data isolation by org_id — the agent inherits this |

The org slug is set during onboarding and stored on the organizations table. It is human-readable, URL-safe, and unique across the platform.

---

## 3. Web Form Agent

### Entry point

A "Get a Quote" button on the booking page renders a chat widget. The widget is a React component that calls the Claude API, maintains conversation history in local state, and writes to Supabase when a booking is confirmed.

### Conversation flow

1. Agent greets with business name pulled from org record
2. Collects: bedrooms, bathrooms, clean type, frequency
3. Calls lookup_price tool — queries pricing matrix in Supabase
4. Presents price and asks if prospect would like to book
5. Calls check_availability tool — fetches 2–3 open slots from schedule
6. Collects prospect's name and phone number
7. Calls create_draft_job tool — writes job to Supabase with status: pending_confirmation
8. Calls notify_owner tool — Supabase edge function sends SMS to owner via Twilio

### Claude API setup

The system prompt scopes the agent to a specific org: its name, pricing matrix, tone, and the exact boundaries of what it can and cannot do. Four tools are passed to the API:

| Tool | Function |
|------|----------|
| lookup_price | Queries pricing matrix by bedrooms x bathrooms x frequency. Returns quoted price. |
| check_availability | Reads the org's schedule for open slots in the next 7 days. Returns 2–3 options. |
| create_draft_job | Writes a new job record to Supabase with status: pending_confirmation and source: agent_web. |
| notify_owner | Triggers a Supabase edge function that sends an SMS to the owner via Twilio. |

Note: Conversation history is passed with every API call — Claude has no memory between turns, so the full thread is maintained in React state and appended on each message.

### Owner confirmation flow

When the agent creates a draft job, the owner receives an SMS:

```
"New booking request: Sarah M — 3bed/2bath standard clean, weekly,
Tuesday 10am. Quoted $120. Reply YES to confirm or NO to decline."
```

A Twilio webhook listens for the owner's reply and updates job status: active on YES, declined on NO. On NO, the agent sends the prospect a message that the owner will follow up directly.

---

## 4. SMS / Phone Agent

### Entry point

Each business org gets a dedicated Twilio phone number (~$1/month). The owner uses this as their booking line — either forwards their existing number to it or lists it on their website.

### Inbound call handling — v1 (SMS fallback)

When someone calls, Twilio plays a brief message and immediately sends the caller an SMS to start the conversation. This is simpler and more reliable than real-time voice for a first version, and most prospects are comfortable with it.

```
"Thanks for calling Hilda's Housecleaning. I'll send you a text
right now to get you a quick quote."

-> Twilio sends SMS to caller's number
-> Same conversational flow as web form begins
```

### Inbound SMS handling

Any SMS to the Twilio number hits a Vercel serverless function (webhook). The function:

1. Loads conversation history from Supabase, keyed by phone number + org_id
2. Calls the Claude API with the new message appended to history
3. Stores the updated conversation history back to Supabase
4. Sends the agent's response back to the prospect via Twilio SMS

The four backend tools (lookup_price, check_availability, create_draft_job, notify_owner) are identical to the web form version. The only difference is the interface layer.

### Voice handling — v2 (later)

Replace the SMS fallback with real-time voice using Twilio Voice + Deepgram for speech-to-text. The agent listens, responds with Twilio text-to-speech, and manages the full conversation by voice. This is a meaningful additional build — defer until the SMS version is working and tested.

---

## 5. Supabase Schema Additions

Three additions required. All are additive — no existing tables are modified in ways that break current functionality.

### organizations table

```sql
ALTER TABLE organizations
  ADD COLUMN org_slug text UNIQUE,
  ADD COLUMN booking_phone text;  -- Twilio number assigned to this org
```

### agent_conversations table (new)

```sql
CREATE TABLE agent_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id),
  contact_phone text NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]',
  status text DEFAULT 'active',  -- active | completed | abandoned
  source text,  -- 'web' | 'sms'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for fast lookup by phone + org (used on every SMS inbound)
CREATE INDEX ON agent_conversations (org_id, contact_phone, status);
```

### jobs table additions

```sql
ALTER TABLE jobs
  ADD COLUMN source text;  -- 'agent_web' | 'agent_sms' | 'manual'
  -- 'pending_confirmation' added to existing status enum/check constraint
```

Note: RLS policies for agent_conversations should allow the service role (used by Vercel functions) full access, and restrict authenticated users to their own org_id — same pattern as existing tables.

---

## 6. Build Order

Web form first, SMS second. Steps 1–4 are shared by both entry points.

| Step | What to build |
|------|--------------|
| 1 | Supabase schema additions — org_slug, booking_phone, agent_conversations table, jobs.source and pending_confirmation status |
| 2 | The /book/[slug] public route in React — no login required, loads org by slug |
| 3 | The four Claude API tool functions — lookup_price, check_availability, create_draft_job, notify_owner |
| 4 | The chat widget React component — handles conversation history in state, calls Claude API, renders messages |
| 5 | Owner confirmation reply handler — Twilio webhook updates job status on YES/NO reply |
| 6 | Twilio inbound SMS webhook — Vercel serverless function, loads history, calls Claude, sends reply |
| 7 | Twilio inbound call handler — plays message, sends SMS to caller, hands off to step 6 |
| 8 (later) | Real-time voice handling via Twilio Voice + Deepgram |

Note: Before starting step 1, the pricing matrix must be populated for at least the first org. The agent cannot quote prices without it — and an agent that fails to quote will create a worse impression than no agent at all.

---

## 7. Rate Limiting

Without a rate limit, a single person or automated script can run up unbounded Claude API and Twilio SMS costs against your account. The fix is simple and should be implemented from the start, not added later.

### The rule

Maximum 10 messages per phone number per org per hour. This covers a full booking conversation (typically 8–12 messages) with a small buffer, while blocking any automated or abusive behavior.

### Implementation — SMS agent

The Vercel webhook function checks message count before calling the Claude API:

```javascript
// In the Twilio SMS webhook handler (Vercel function)
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

// Count total messages across active conversation
const messageCount = conversation?.messages?.length ?? 0;

if (messageCount >= 10) {
  await twilioClient.messages.create({
    to: fromPhone,
    from: orgPhone,
    body: `Thanks for your interest in ${orgName}. ` +
      `Please call us directly to complete your booking.`
  });
  return res.status(200).send(); // Return 200 so Twilio doesn't retry
}

// Proceed with Claude API call...
```

### Implementation — web form agent

The chat widget tracks message count in React state. When the count reaches 10, the input is disabled and a message is shown:

```javascript
// In the chat widget component
const MAX_MESSAGES = 10;

if (messageHistory.length >= MAX_MESSAGES) {
  return (
    <div className="rate-limit-message">
      To complete your booking, please call us directly.
      <a href={`tel:${org.booking_phone}`}>{org.booking_phone}</a>
    </div>
  );
}
```

### Additional protection

- Set max_tokens: 1000 on every Claude API call — already in the spec, ensures no runaway output costs
- The Vercel function should return HTTP 200 to Twilio even when rate-limited — if you return an error, Twilio will retry the webhook, compounding the problem
- Log rate limit events to the audit_log table for visibility — if a number is hitting limits repeatedly, you want to know about it

Note: The rate limit threshold of 10 messages per hour is intentionally generous — it covers a complete booking conversation. You can tighten it to 15 per 24 hours once you have data on real conversation lengths.

---

## 8. Cost Model

### Per-conversation cost breakdown

| Item | Cost |
|------|------|
| Claude API (Sonnet 4) | $3/M input tokens + $15/M output tokens. Full booking conversation: ~3,000–5,000 tokens total. Cost: $0.05–$0.10 per conversation. |
| Twilio SMS | $0.0079 per message sent or received. Full SMS booking thread: 10–16 messages. Cost: $0.08–$0.13 per conversation. |
| Twilio phone number | $1.00/month per org. Fixed cost regardless of volume. |
| Total per booking conversation | ~$0.15–$0.25 all-in. |

### At scale

At Hilda's likely volume — 40 conversations per month, most converting — monthly infrastructure cost is $6–$10 for her org. This is comfortably inside the margin of any subscription tier.

| Scale | Infrastructure cost |
|-------|-------------------|
| 10 customers, 40 conversations/mo each | ~$60–$100/month |
| 50 customers, 40 conversations/mo each | ~$300–$500/month |
| 50 customers, subscription revenue | $3,950–$12,450/month (Starter to Growth mix) |

The infrastructure cost at 50 customers represents roughly 4–8% of minimum subscription revenue. Not a concern at any realistic scale.

### The only cost risk

Automated scripts or bots hammering the booking endpoint. This is addressed by the rate limiting in Section 7. Without rate limiting, a single bad actor could generate meaningful Claude API costs in minutes. With the 10-message-per-hour limit in place, the maximum cost per phone number per hour is approximately $1.00 — negligible even if several hit simultaneously.

---

## 9. Pre-Build Checklist

Two dependencies must be in place before the agent is built. Building without them creates a system that will fail at the most visible moment.

| Dependency | Status | Why it matters |
|-----------|--------|---------------|
| Pricing matrix populated | BLOCKED — waiting on Hilda | The agent cannot quote prices without it. An agent that fails to produce a price creates a worse impression than no agent. For development/testing, use dummy pricing data in a test org. |
| Worker assignment fix deployed | DONE (shipped March 25) | The agent creates draft jobs in Supabase. Worker assignment is now a required field with explicit "Unassigned" option, so agent-created jobs will be properly flagged. |

Note: Steps 1–4 of the build can proceed using a test org with dummy pricing data. The agent cannot go live for Hilda's org until her pricing matrix is populated.

---

## 10. Important Schema Notes for Claude Code

- The database table is spelled `organizations` (US spelling), not `organisations`
- Workers are rows in the `users` table with `role = 'worker'` — there is no separate workers table
- Organization settings (timezone, time_format, tax_rate, currency, country, currency_symbol, payment_methods) are stored in a JSONB column called `settings` on the `organizations` table
- The org_slug column being added must match the existing naming pattern — lowercase, hyphens, no spaces
- All new tables and columns must have appropriate RLS policies following the existing pattern
- Edge Functions use `--no-verify-jwt` for deployment but implement their own auth checks internally
- The Anthropic API model to use is `claude-sonnet-4-20250514`

---

*© 2026 TimelyOps — Confidential*
