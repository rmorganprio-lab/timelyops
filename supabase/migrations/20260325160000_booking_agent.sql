-- Add 'lead' status to clients
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_status_check;
ALTER TABLE clients ADD CONSTRAINT clients_status_check
  CHECK (status IN ('active', 'inactive', 'vip', 'lead'));

-- Add source column to jobs (tracks whether job came from manual entry, web booking, or SMS booking)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual'
  CHECK (source IN ('manual', 'web_booking', 'sms_booking'));

-- booking_conversations: stores multi-turn chat sessions for the AI booking agent
CREATE TABLE IF NOT EXISTS booking_conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  channel       text NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'sms')),
  contact_phone text,
  contact_name  text,
  messages      jsonb NOT NULL DEFAULT '[]',
  state         jsonb NOT NULL DEFAULT '{}',
  job_id        uuid REFERENCES jobs(id),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE booking_conversations ENABLE ROW LEVEL SECURITY;

-- Platform admins can read all conversations; the booking agent uses service role (bypasses RLS)
CREATE POLICY "Platform admin all on booking_conversations"
  ON booking_conversations
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_platform_admin = true)
  );
