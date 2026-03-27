export const TIERS = {
  starter: {
    name: 'Starter',
    price: 99,
    maxStaff: 5,
    features: [
      'dashboard',
      'clients',
      'workers',
      'schedule',
      'quotes',
      'payments',
      'invoices',
      'reports_view',
      'client_timeline',
      'worker_checkin_time',
    ]
  },
  professional: {
    name: 'Professional',
    price: 149,
    maxStaff: 10,
    features: [
      'reports_export',
      'automated_reminders',
      'job_checklists',
      'worker_gps_checkin',
      'auto_review_requests',
    ]
  },
  growth: {
    name: 'Growth',
    price: 249,
    maxStaff: 15,
    features: [
      'ai_lead_agents',
      'client_booking_portal',
      'quickbooks_sync',
      'supply_tracking',
    ]
  }
};

export const ADD_ONS = {
  automated_reminders:    { name: 'Automated Reminders',             price: 19 },
  reports_export:         { name: 'Reporting & Accountant Export',   price: 19 },
  job_checklists:         { name: 'Job Checklists',                  price: 9  },
  worker_gps_checkin:     { name: 'Worker GPS Check-in',             price: 9  },
  auto_review_requests:   { name: 'Auto Review Requests',            price: 9  },
  client_booking_portal:  { name: 'Client Booking Portal',           price: 19 },
  ai_lead_agents:         { name: 'AI Lead Agents',                  price: 79 },
  quickbooks_sync:        { name: 'QuickBooks Sync',                 price: 19 },
  supply_tracking:        { name: 'Supply Tracking',                 price: 9  },
};

export function hasFeature(org, featureSlug) {
  if (!org) return false;
  const tierOrder = ['starter', 'professional', 'growth'];
  const orgTierIndex = tierOrder.indexOf(org.subscription_tier || 'starter');
  for (let i = 0; i <= orgTierIndex; i++) {
    if (TIERS[tierOrder[i]].features.includes(featureSlug)) return true;
  }
  const addOns = org.add_ons || [];
  if (addOns.includes(featureSlug)) return true;
  return false;
}

export function requiredTier(featureSlug) {
  for (const [key, tier] of Object.entries(TIERS)) {
    if (tier.features.includes(featureSlug)) return { tier: key, name: tier.name, price: tier.price };
  }
  return null;
}
