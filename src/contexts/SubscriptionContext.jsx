import { createContext, useContext } from 'react'
import { hasFeature as _hasFeature } from '../lib/tiers'

const SubscriptionContext = createContext(null)

export function SubscriptionProvider({ user, children }) {
  const org = user?.organizations ?? null

  function hasFeature(slug) {
    return _hasFeature(org, slug)
  }

  const value = {
    org,
    tier:             org?.subscription_tier    ?? 'starter',
    status:           org?.subscription_status  ?? 'active',
    addOns:           org?.add_ons              ?? [],
    trialEndsAt:      org?.trial_ends_at        ?? null,
    isFoundingCustomer: org?.is_founding_customer ?? false,
    hasFeature,
  }

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  )
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext)
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider')
  return ctx
}
