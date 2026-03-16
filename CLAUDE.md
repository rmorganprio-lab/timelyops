# AllBookd — Claude Code Project Context

## What this is
AllBookd is a multi-tenant business management SaaS for small service businesses, starting with housecleaning. It is being built by a solo founder (Rich) with a stealth first customer already lined up.

## Tech stack
- **Frontend:** React + Vite + Tailwind CSS
- **Backend/DB:** Supabase (Postgres, Auth, Storage)
- **Hosting:** Vercel
- **SMS/Voice:** Twilio
- **AI:** Anthropic Claude API (claude-sonnet-4-6)
- **Auth:** Phone OTP via Twilio + Supabase

## Current state
- Supabase project is live with full database schema deployed
- React app scaffolding is live on Vercel
- Phone OTP authentication is implemented
- **Known open issue:** Twilio trial account blocks SMS to Netherlands numbers — Rich is based in NL and tests from a NL number

## Pricing tiers
- **Starter** $79/mo — core scheduling, client management, invoicing
- **Professional** $119/mo — adds online booking, automated reminders
- **Growth** $249/mo — adds AI agent system (email, WhatsApp, phone/voicemail via Claude API + Twilio)
- **Add-ons** available; $500 implementation fee for all new customers
- Founding customer discount structure in place

## Key differentiator
The Growth tier AI agent system — handles inbound/outbound client communication automatically via Claude API and Twilio. This is the primary competitive moat.

## Architecture principles
- Multi-tenant: all data scoped by `business_id`
- Keep it simple and shippable — this is an MVP with a real first customer
- Favour Supabase built-ins (RLS, auth, edge functions) over custom backend code
- Don't over-engineer; Rich has ~12 months runway and is building solo

## Coding conventions
- Use TypeScript
- Tailwind for all styling — no separate CSS files
- Components in `/src/components`
- Pages in `/src/pages`
- Supabase client in `/src/lib/supabase.ts`
- Keep components small and focused
- Always consider multi-tenancy (business_id scoping) when touching DB queries

## How to work with Rich
- Be direct and skip the caveats — Rich has a strong technical background (20+ years supply chain and ops, comfortable with code)
- Always use Plan mode for anything that touches multiple files or the database schema
- Commit working code to git before starting any large change
- Surface trade-offs clearly rather than just picking one approach silently
- If something is ambiguous, ask one focused question rather than listing five options
