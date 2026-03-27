# TimelyOps — Industry Profiles Implementation Brief

**Date:** March 26, 2026
**Status:** Ready for implementation
**Scope:** Platform-level industry profile templates, admin management UI, org setup integration

---

## BEFORE STARTING: Git checkpoint

```
git add -A && git commit -m "pre-industry-profiles checkpoint"
```

---

## What this builds

A template system where the platform admin (Rich) defines industry profiles, each containing a set of default service types. When onboarding a new customer, the admin picks one or more profiles and the service types are automatically copied into the org. Business owners can then customize their service types without affecting the master templates.

---

## Phase 1: Database Schema

### 1A. Industry profiles table (platform-level, not org-scoped)

```sql
CREATE TABLE industry_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Only platform admins can manage profiles
ALTER TABLE industry_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can do everything with profiles"
  ON industry_profiles FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_platform_admin = true)
  );

-- Anon and authenticated non-admins can read active profiles
-- (needed during org setup flows)
CREATE POLICY "Anyone can read active profiles"
  ON industry_profiles FOR SELECT
  TO authenticated
  USING (is_active = true);
```

### 1B. Profile service types table (templates, not org-scoped)

```sql
CREATE TABLE profile_service_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES industry_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  default_duration_minutes integer DEFAULT 120,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profile_service_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can do everything with profile service types"
  ON profile_service_types FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_platform_admin = true)
  );

CREATE POLICY "Anyone can read profile service types"
  ON profile_service_types FOR SELECT
  TO authenticated
  USING (true);
```

### 1C. Track which profiles an org was set up with

```sql
-- Junction table linking orgs to their selected profiles
CREATE TABLE organization_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES industry_profiles(id) ON DELETE CASCADE,
  applied_at timestamptz DEFAULT now(),
  UNIQUE(org_id, profile_id)
);

ALTER TABLE organization_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can manage org profiles"
  ON organization_profiles FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_platform_admin = true)
  );

CREATE POLICY "Org members can see their own profiles"
  ON organization_profiles FOR SELECT
  TO authenticated
  USING (org_id = user_org_id());
```

### 1D. Seed all 12 industry profiles and their service types

```sql
-- Residential Cleaning
WITH p AS (
  INSERT INTO industry_profiles (name, description, sort_order)
  VALUES ('Residential Cleaning', 'Regular home cleaning services', 1)
  RETURNING id
)
INSERT INTO profile_service_types (profile_id, name, description, default_duration_minutes, sort_order)
SELECT p.id, s.name, s.description, s.duration, s.sort
FROM p, (VALUES
  ('Standard Clean', 'Regular maintenance cleaning', 120, 1),
  ('Deep Clean', 'Thorough top-to-bottom cleaning', 240, 2),
  ('Move In/Out Clean', 'Comprehensive cleaning for moves', 300, 3),
  ('Post-Construction Clean', 'Cleanup after renovation or building work', 360, 4),
  ('One-Time Clean', 'Single visit, no recurring schedule', 180, 5)
) AS s(name, description, duration, sort);

-- Commercial Cleaning
WITH p AS (
  INSERT INTO industry_profiles (name, description, sort_order)
  VALUES ('Commercial Cleaning', 'Office and commercial space cleaning', 2)
  RETURNING id
)
INSERT INTO profile_service_types (profile_id, name, description, default_duration_minutes, sort_order)
SELECT p.id, s.name, s.description, s.duration, s.sort
FROM p, (VALUES
  ('Office Clean', 'Regular office maintenance cleaning', 120, 1),
  ('Floor Care', 'Stripping, waxing, buffing hard floors', 180, 2),
  ('Carpet Cleaning', 'Deep carpet extraction and spot treatment', 120, 3),
  ('Window Cleaning', 'Interior and exterior window washing', 150, 4),
  ('Post-Event Clean', 'Cleanup after corporate events or functions', 240, 5)
) AS s(name, description, duration, sort);

-- Landscaping
WITH p AS (
  INSERT INTO industry_profiles (name, description, sort_order)
  VALUES ('Landscaping', 'Lawn care, garden maintenance, and outdoor services', 3)
  RETURNING id
)
INSERT INTO profile_service_types (profile_id, name, description, default_duration_minutes, sort_order)
SELECT p.id, s.name, s.description, s.duration, s.sort
FROM p, (VALUES
  ('Lawn Mowing', 'Regular mowing, edging, and blowing', 60, 1),
  ('Hedge Trimming', 'Hedge and shrub shaping and trimming', 90, 2),
  ('Garden Maintenance', 'Weeding, mulching, bed maintenance', 120, 3),
  ('Leaf Removal', 'Seasonal leaf cleanup and disposal', 90, 4),
  ('Lawn Treatment', 'Fertilizing, aerating, overseeding', 45, 5),
  ('Irrigation Repair', 'Sprinkler system repair and adjustment', 90, 6)
) AS s(name, description, duration, sort);

-- Plumbing
WITH p AS (
  INSERT INTO industry_profiles (name, description, sort_order)
  VALUES ('Plumbing', 'Residential and light commercial plumbing', 4)
  RETURNING id
)
INSERT INTO profile_service_types (profile_id, name, description, default_duration_minutes, sort_order)
SELECT p.id, s.name, s.description, s.duration, s.sort
FROM p, (VALUES
  ('Service Call', 'Diagnostic visit and minor repair', 60, 1),
  ('Drain Cleaning', 'Clearing clogged drains and lines', 90, 2),
  ('Fixture Install', 'Faucet, toilet, or fixture replacement', 120, 3),
  ('Water Heater Service', 'Repair, flush, or replacement', 150, 4),
  ('Leak Repair', 'Pipe and fitting leak diagnosis and repair', 90, 5),
  ('Sewer Line Service', 'Camera inspection and sewer repair', 180, 6)
) AS s(name, description, duration, sort);

-- Electrical
WITH p AS (
  INSERT INTO industry_profiles (name, description, sort_order)
  VALUES ('Electrical', 'Residential and light commercial electrical work', 5)
  RETURNING id
)
INSERT INTO profile_service_types (profile_id, name, description, default_duration_minutes, sort_order)
SELECT p.id, s.name, s.description, s.duration, s.sort
FROM p, (VALUES
  ('Service Call', 'Diagnostic visit and minor repair', 60, 1),
  ('Outlet/Switch Install', 'Install or replace outlets and switches', 45, 2),
  ('Lighting Install', 'Fixture installation, recessed lighting', 90, 3),
  ('Panel Work', 'Breaker panel upgrades and repairs', 180, 4),
  ('Ceiling Fan Install', 'Fan installation and wiring', 60, 5),
  ('Electrical Inspection', 'Full home electrical safety inspection', 120, 6)
) AS s(name, description, duration, sort);

-- HVAC
WITH p AS (
  INSERT INTO industry_profiles (name, description, sort_order)
  VALUES ('HVAC', 'Heating, ventilation, and air conditioning', 6)
  RETURNING id
)
INSERT INTO profile_service_types (profile_id, name, description, default_duration_minutes, sort_order)
SELECT p.id, s.name, s.description, s.duration, s.sort
FROM p, (VALUES
  ('AC Tune-Up', 'Annual AC maintenance and inspection', 90, 1),
  ('Heating Tune-Up', 'Annual furnace/boiler maintenance', 90, 2),
  ('Repair Visit', 'Diagnostic and repair', 120, 3),
  ('Filter Replacement', 'Air filter change and system check', 30, 4),
  ('Duct Cleaning', 'Full ductwork cleaning and sanitizing', 240, 5),
  ('System Install', 'New HVAC unit installation', 480, 6)
) AS s(name, description, duration, sort);

-- Pest Control
WITH p AS (
  INSERT INTO industry_profiles (name, description, sort_order)
  VALUES ('Pest Control', 'Residential and commercial pest management', 7)
  RETURNING id
)
INSERT INTO profile_service_types (profile_id, name, description, default_duration_minutes, sort_order)
SELECT p.id, s.name, s.description, s.duration, s.sort
FROM p, (VALUES
  ('General Treatment', 'Interior/exterior spray treatment', 60, 1),
  ('Termite Inspection', 'Full property termite assessment', 90, 2),
  ('Rodent Control', 'Trapping, baiting, and exclusion', 75, 3),
  ('Bed Bug Treatment', 'Full room heat or chemical treatment', 180, 4),
  ('Mosquito Treatment', 'Yard spray and larvicide application', 45, 5)
) AS s(name, description, duration, sort);

-- Painting
WITH p AS (
  INSERT INTO industry_profiles (name, description, sort_order)
  VALUES ('Painting', 'Interior and exterior painting services', 8)
  RETURNING id
)
INSERT INTO profile_service_types (profile_id, name, description, default_duration_minutes, sort_order)
SELECT p.id, s.name, s.description, s.duration, s.sort
FROM p, (VALUES
  ('Interior Room', 'Single room painting (walls and trim)', 240, 1),
  ('Exterior House', 'Full exterior painting', 480, 2),
  ('Cabinet Painting', 'Kitchen or bathroom cabinet refinishing', 360, 3),
  ('Deck/Fence Staining', 'Deck or fence stain and seal', 240, 4),
  ('Touch-Up/Repair', 'Patch, prime, and repaint damaged areas', 120, 5)
) AS s(name, description, duration, sort);

-- Pool Service
WITH p AS (
  INSERT INTO industry_profiles (name, description, sort_order)
  VALUES ('Pool Service', 'Pool cleaning and maintenance', 9)
  RETURNING id
)
INSERT INTO profile_service_types (profile_id, name, description, default_duration_minutes, sort_order)
SELECT p.id, s.name, s.description, s.duration, s.sort
FROM p, (VALUES
  ('Weekly Maintenance', 'Chemical balance, skim, vacuum, filter check', 45, 1),
  ('Green Pool Recovery', 'Algae treatment and full restoration', 180, 2),
  ('Equipment Repair', 'Pump, filter, heater diagnosis and repair', 120, 3),
  ('Opening/Closing', 'Seasonal pool opening or winterization', 120, 4),
  ('Tile Cleaning', 'Calcium and scale removal from tile line', 90, 5)
) AS s(name, description, duration, sort);

-- Handyman
WITH p AS (
  INSERT INTO industry_profiles (name, description, sort_order)
  VALUES ('Handyman', 'General home repair and maintenance', 10)
  RETURNING id
)
INSERT INTO profile_service_types (profile_id, name, description, default_duration_minutes, sort_order)
SELECT p.id, s.name, s.description, s.duration, s.sort
FROM p, (VALUES
  ('Small Repair (1 hr)', 'Minor fix — door, drywall, hardware, etc.', 60, 1),
  ('Medium Project (2 hr)', 'Moderate task — shelving, assembly, etc.', 120, 2),
  ('Large Project (4 hr)', 'Bigger job — multiple repairs, install', 240, 3),
  ('Furniture Assembly', 'Flat-pack assembly and placement', 90, 4),
  ('Pressure Washing', 'Driveway, patio, siding wash', 120, 5)
) AS s(name, description, duration, sort);

-- Carpet/Upholstery Cleaning
WITH p AS (
  INSERT INTO industry_profiles (name, description, sort_order)
  VALUES ('Carpet/Upholstery Cleaning', 'Specialized fabric and carpet cleaning', 11)
  RETURNING id
)
INSERT INTO profile_service_types (profile_id, name, description, default_duration_minutes, sort_order)
SELECT p.id, s.name, s.description, s.duration, s.sort
FROM p, (VALUES
  ('Room Carpet Clean', 'Per-room deep extraction cleaning', 45, 1),
  ('Whole House Carpet', 'Full home carpet cleaning package', 180, 2),
  ('Upholstery Clean', 'Sofa, chair, or mattress cleaning', 60, 3),
  ('Rug Cleaning', 'Area rug pickup, clean, and return', 30, 4),
  ('Stain Treatment', 'Spot and stain removal treatment', 30, 5)
) AS s(name, description, duration, sort);

-- Junk Removal
WITH p AS (
  INSERT INTO industry_profiles (name, description, sort_order)
  VALUES ('Junk Removal', 'Hauling, cleanout, and disposal services', 12)
  RETURNING id
)
INSERT INTO profile_service_types (profile_id, name, description, default_duration_minutes, sort_order)
SELECT p.id, s.name, s.description, s.duration, s.sort
FROM p, (VALUES
  ('Single Item Pickup', 'One large item removal', 30, 1),
  ('Partial Load', 'Small cleanout or multiple items', 60, 2),
  ('Full Load', 'Full truck load removal', 120, 3),
  ('Garage Cleanout', 'Complete garage clearing and hauling', 180, 4),
  ('Estate Cleanout', 'Full property cleanout', 360, 5)
) AS s(name, description, duration, sort);
```

---

## Phase 2: Admin UI — Profile Management

### 2A. New admin page: Industry Profiles

Create a new admin page at `/admin/profiles` (add to admin nav in Layout.jsx). This is where Rich manages the master template library.

**Profile list view:**
- Shows all profiles in a card list, sorted by sort_order
- Each card shows: profile name, description, number of service types, active/inactive badge
- "Add Profile" button at the top
- Click a profile to expand/edit it

**Profile edit view (expanded inline or modal):**
- Edit profile name and description
- Toggle active/inactive
- Drag-to-reorder (or simple up/down arrows) for sort order
- Delete profile (with confirmation — warn if any orgs are using it)

**Service types within a profile:**
- Listed below the profile details
- Each service type shows: name, description, default duration
- Inline edit — click to modify name, description, or duration
- Add new service type button
- Delete service type (with confirmation)
- Drag-to-reorder (or up/down arrows)

### 2B. Profile picker in AdminOrgs.jsx

When creating or editing an org, add an "Industry Profiles" section:

- Multi-select interface showing all active profiles
- Checkbox list or pill/chip selector — check one or more profiles
- When profiles are selected and saved, the copy logic runs (Phase 3)
- Show which profiles are currently applied to the org
- "Reapply profiles" button that adds any new service types from the master template that don't already exist in the org (does NOT overwrite existing customizations)

---

## Phase 3: Copy-on-Select Logic

### 3A. When profiles are applied to an org

When the admin selects profiles for an org and saves:

1. Record the selection in `organization_profiles` (junction table)
2. For each selected profile, copy its service types into the org's `service_types` table:
   - Map `profile_service_types.name` → `service_types.name`
   - Map `profile_service_types.description` → `service_types.description`
   - Map `profile_service_types.default_duration_minutes` → `service_types.default_duration_minutes` (add this column to service_types if it doesn't exist)
   - Set `service_types.is_active = true`
   - Set `service_types.org_id` to the target org
3. Deduplicate: if a service type with the same name already exists in the org (from a previous profile application or manual creation), skip it — do NOT overwrite
4. Show a summary toast: "Added 5 service types from Residential Cleaning, 6 from Plumbing. 2 already existed and were skipped."

### 3B. Add default_duration_minutes to service_types if missing

```sql
-- Check if this column exists first. Only add if missing.
ALTER TABLE service_types 
  ADD COLUMN IF NOT EXISTS default_duration_minutes integer DEFAULT 120;
```

---

## Phase 4: Owner-Facing Service Type Management

### 4A. Update Settings.jsx — Service Types section

The business owner needs to see and manage their service types in Settings. This section should show:

- All service types for the org in a clean list
- Each row: name (editable), description (editable), default duration (editable), active/inactive toggle
- "Add Service Type" button for custom additions
- Delete button per service type (with confirmation — warn if it's used in the pricing matrix or existing jobs)
- Clear labeling: "These are the services your business offers. They appear in quotes, the booking agent, and the pricing matrix."

This improves what's already there — the current free-form text box approach is replaced by a structured list that came pre-populated from the industry profiles.

---

## Phase 5: Test and Verify

### 5A. Admin profile management
1. Go to /admin/profiles — do all 12 profiles appear with correct service types?
2. Edit a profile name and description — does it save?
3. Add a new service type to Residential Cleaning (e.g., "Window Washing") — does it save?
4. Delete a service type from a profile — does it work?
5. Create a brand new profile from scratch — does it work?

### 5B. Org setup with profiles
6. Create a new test org in AdminOrgs
7. Select "Plumbing" and "Handyman" profiles
8. Save — do the service types from both profiles appear in the org's service types?
9. Go to the org's Settings page — do the service types show with edit capability?
10. Open the pricing matrix — are the service types available as tabs?
11. Try the booking agent for the test org — does it list the correct service types?

### 5C. Edge cases
12. Select a profile that was already applied — does it skip duplicates correctly?
13. Add a custom service type in Settings, then reapply profiles — does the custom one survive?
14. Delete a service type that has pricing matrix entries — does it warn before deleting?

### 5D. Update documentation
Update memory.md to reflect:
- New tables: industry_profiles, profile_service_types, organization_profiles
- New admin page: /admin/profiles
- Profile picker in AdminOrgs
- Service type management in Settings.jsx
- 12 industry profiles seeded with service types
- default_duration_minutes added to service_types

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Profiles are platform-level, not org-scoped | They're templates managed by Rich, not customer data |
| Copy on select, not reference | Orgs get independent copies so they can customize without affecting the template |
| Multi-select profiles | A business might do both residential and commercial cleaning |
| Dedup by name on copy | Prevents duplicates when reapplying or selecting overlapping profiles |
| All 12 profiles seeded at once | No cost to having them ready; a plumber or handyman could sign up tomorrow |
| No price in templates | Pricing varies by business; owners set their own via the pricing matrix |
| Reapply adds new, doesn't overwrite | Protects owner customizations when Rich adds new service types to a master template |
