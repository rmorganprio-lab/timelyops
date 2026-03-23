import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function fmtCurrency(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0)
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function QuoteApproval() {
  const { token } = useParams()
  const [state, setState] = useState('loading') // loading | not_found | approved | declined | pending
  const [quote, setQuote] = useState(null)
  const [showDeclineForm, setShowDeclineForm] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase.functions.invoke('quote-action', {
          body: { action: 'get_quote', token },
        })
        if (error || !data?.quote) { setState('not_found'); return }
        const q = data.quote
        setQuote(q)
        if (q.approved_at) setState('approved')
        else if (q.declined_at) setState('declined')
        else setState('pending')
      } catch {
        setState('not_found')
      }
    }
    load()
  }, [token])

  async function handleApprove() {
    setSubmitting(true)
    setError(null)
    try {
      const { data, error } = await supabase.functions.invoke('quote-action', {
        body: { action: 'approve_quote', token },
      })
      if (error || data?.error) {
        setError('Something went wrong. Please try again.')
        return
      }
      setState('approved')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDecline() {
    setSubmitting(true)
    setError(null)
    try {
      const { data, error } = await supabase.functions.invoke('quote-action', {
        body: { action: 'decline_quote', token, reason: declineReason || undefined },
      })
      if (error || data?.error) {
        setError('Something went wrong. Please try again.')
        return
      }
      setState('declined')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const lineItems = quote?.quote_line_items?.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) ?? []
  const org = quote?.organizations
  const client = quote?.clients

  return (
    <div className="min-h-screen bg-stone-100 py-10 px-4">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        {org && (
          <div className="mb-6 text-center">
            <div className="text-sm text-stone-500">Quote from</div>
            <div className="text-xl font-bold text-stone-900">{org.name}</div>
          </div>
        )}

        {/* Loading */}
        {state === 'loading' && (
          <div className="bg-white rounded-2xl shadow-sm p-10 text-center text-stone-400">Loading…</div>
        )}

        {/* Not found */}
        {state === 'not_found' && (
          <div className="bg-white rounded-2xl shadow-sm p-10 text-center">
            <div className="text-4xl mb-4">🔍</div>
            <div className="font-semibold text-stone-800 mb-2">Quote not found</div>
            <div className="text-sm text-stone-500">This link may be invalid or expired.</div>
          </div>
        )}

        {/* Already approved */}
        {state === 'approved' && (
          <div className="bg-white rounded-2xl shadow-sm p-10 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="font-semibold text-stone-800 mb-2">Quote approved</div>
            <div className="text-sm text-stone-500">
              {quote?.approved_at
                ? `Approved on ${fmtDate(quote.approved_at)}.`
                : 'This quote has been approved.'}
              {org && ` ${org.name} will be in touch shortly.`}
            </div>
          </div>
        )}

        {/* Already declined */}
        {state === 'declined' && (
          <div className="bg-white rounded-2xl shadow-sm p-10 text-center">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div className="font-semibold text-stone-800 mb-2">Quote declined</div>
            {quote?.decline_reason && (
              <div className="text-sm text-stone-500 italic mb-2">"{quote.decline_reason}"</div>
            )}
            <div className="text-sm text-stone-500">
              {org ? `Contact ${org.name} if you\u2019d like to revisit this.` : "Contact the business if you\u2019d like to revisit this."}
            </div>
          </div>
        )}

        {/* Pending — main quote view */}
        {state === 'pending' && quote && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {/* Quote meta */}
            <div className="p-6 border-b border-stone-100">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs text-stone-400 uppercase tracking-wide mb-1">Quote</div>
                  <div className="text-2xl font-bold text-stone-900">#{quote.quote_number}</div>
                  {client && <div className="text-sm text-stone-500 mt-1">Prepared for {client.name}</div>}
                </div>
                <div className="text-right text-sm text-stone-500 space-y-1">
                  {quote.issue_date && <div>Issued {fmtDate(quote.issue_date)}</div>}
                  {quote.expiry_date && <div className="text-amber-600">Expires {fmtDate(quote.expiry_date)}</div>}
                </div>
              </div>
            </div>

            {/* Line items */}
            <div className="p-6 border-b border-stone-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-stone-400 text-xs uppercase tracking-wide border-b border-stone-100">
                    <th className="pb-2 font-medium">Description</th>
                    <th className="pb-2 font-medium text-right">Qty</th>
                    <th className="pb-2 font-medium text-right">Unit</th>
                    <th className="pb-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item) => (
                    <tr key={item.id} className="border-b border-stone-50 last:border-0">
                      <td className="py-2 text-stone-800">{item.description}</td>
                      <td className="py-2 text-stone-500 text-right">{item.quantity}</td>
                      <td className="py-2 text-stone-500 text-right">{fmtCurrency(item.unit_price)}</td>
                      <td className="py-2 text-stone-800 font-medium text-right">{fmtCurrency(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="p-6 border-b border-stone-100">
              <div className="space-y-1 text-sm max-w-xs ml-auto">
                <div className="flex justify-between text-stone-500">
                  <span>Subtotal</span>
                  <span>{fmtCurrency(quote.subtotal)}</span>
                </div>
                {quote.tax_rate > 0 && (
                  <div className="flex justify-between text-stone-500">
                    <span>Tax ({quote.tax_rate}%)</span>
                    <span>{fmtCurrency(quote.tax_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-stone-900 text-base pt-1 border-t border-stone-200">
                  <span>Total</span>
                  <span>{fmtCurrency(quote.total)}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {quote.notes && (
              <div className="px-6 py-4 border-b border-stone-100">
                <div className="text-xs text-stone-400 uppercase tracking-wide mb-1">Notes</div>
                <div className="text-sm text-stone-600 whitespace-pre-line">{quote.notes}</div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
            )}

            {/* Decline form */}
            {showDeclineForm && (
              <div className="p-6 border-t border-stone-100 bg-stone-50">
                <div className="text-sm font-medium text-stone-700 mb-2">Reason for declining (optional)</div>
                <textarea
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 resize-none"
                  rows={3}
                  placeholder="Let us know why you're declining…"
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                />
                <div className="flex gap-3 mt-3">
                  <button
                    onClick={handleDecline}
                    disabled={submitting}
                    className="flex-1 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {submitting ? 'Submitting…' : 'Confirm decline'}
                  </button>
                  <button
                    onClick={() => { setShowDeclineForm(false); setDeclineReason('') }}
                    disabled={submitting}
                    className="flex-1 py-2.5 bg-white border border-stone-200 text-stone-600 text-sm font-semibold rounded-lg hover:bg-stone-50 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Action buttons */}
            {!showDeclineForm && (
              <div className="p-6 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleApprove}
                  disabled={submitting}
                  className="flex-1 py-3 bg-emerald-700 text-white font-semibold rounded-xl hover:bg-emerald-800 disabled:opacity-50 transition-colors text-sm"
                >
                  {submitting ? 'Approving…' : 'Approve quote'}
                </button>
                <button
                  onClick={() => setShowDeclineForm(true)}
                  disabled={submitting}
                  className="flex-1 py-3 bg-white border border-stone-200 text-stone-700 font-semibold rounded-xl hover:bg-stone-50 disabled:opacity-50 transition-colors text-sm"
                >
                  Decline
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 text-center text-xs text-stone-400">
          Powered by <a href="https://timelyops.com" className="text-emerald-700 font-semibold hover:underline">TimelyOps</a>
        </div>
      </div>
    </div>
  )
}
