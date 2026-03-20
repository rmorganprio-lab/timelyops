import { useSubscription } from '../contexts/SubscriptionContext'
import { requiredTier } from '../lib/tiers'

function UpgradePrompt({ featureSlug }) {
  const needed = requiredTier(featureSlug)
  if (!needed) return null

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6 text-center max-w-sm mx-auto">
      <div className="inline-flex items-center justify-center w-10 h-10 bg-emerald-50 rounded-xl mb-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#047857" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <p className="text-sm font-semibold text-stone-800 mb-1">
        {needed.name} plan required
      </p>
      <p className="text-sm text-stone-500 mb-4">
        This feature is included in the {needed.name} plan at ${needed.price}/mo.
      </p>
      <a
        href="mailto:info@timelyops.com?subject=Upgrade%20enquiry"
        className="inline-block px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors"
      >
        Contact us to upgrade
      </a>
    </div>
  )
}

export default function FeatureGate({ feature, children, fallback }) {
  const { hasFeature } = useSubscription()

  if (hasFeature(feature)) return children

  if (fallback !== undefined) return fallback

  return <UpgradePrompt featureSlug={feature} />
}
