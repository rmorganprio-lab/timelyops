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

export default function PaymentReceipt() {
  const { token } = useParams()
  const [state, setState] = useState('loading') // loading | not_found | loaded
  const [receipt, setReceipt] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase.functions.invoke('quote-action', {
          body: { action: 'get_receipt', token },
        })
        if (error || !data?.receipt) { setState('not_found'); return }
        setReceipt(data.receipt)
        setState('loaded')
      } catch {
        setState('not_found')
      }
    }
    load()
  }, [token])

  const org = receipt?.organizations
  const client = receipt?.clients
  const invoice = receipt?.invoices
  const remaining = invoice?.total ? Number(invoice.total) - Number(receipt?.amount ?? 0) : null
  const isPaidInFull = remaining !== null && remaining <= 0.005

  return (
    <div className="min-h-screen bg-stone-100 py-10 px-4">
      <div className="max-w-xl mx-auto">
        {org && (
          <div className="mb-6 text-center">
            <div className="text-sm text-stone-500">Receipt from</div>
            <div className="text-xl font-bold text-stone-900">{org.name}</div>
          </div>
        )}

        {state === 'loading' && (
          <div className="bg-white rounded-2xl shadow-sm p-10 text-center text-stone-400">Loading…</div>
        )}

        {state === 'not_found' && (
          <div className="bg-white rounded-2xl shadow-sm p-10 text-center">
            <div className="text-4xl mb-4">🔍</div>
            <div className="font-semibold text-stone-800 mb-2">Receipt not found</div>
            <div className="text-sm text-stone-500">This link may be invalid or expired.</div>
          </div>
        )}

        {state === 'loaded' && receipt && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {/* Amount hero */}
            <div className="p-8 border-b border-stone-100 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="text-4xl font-bold text-emerald-700 mb-1">{fmtCurrency(receipt.amount)}</div>
              <div className="text-sm text-stone-500">Payment received</div>
              {client && (
                <div className="text-sm text-stone-700 mt-1.5">
                  Thank you, {client.name.split(' ')[0]}!
                </div>
              )}
            </div>

            {/* Details */}
            <div className="p-6 space-y-3 border-b border-stone-100">
              <div className="flex justify-between text-sm">
                <span className="text-stone-500">Date</span>
                <span className="text-stone-800 font-medium">{fmtDate(receipt.date)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-stone-500">Payment method</span>
                <span className="text-stone-800 font-medium capitalize">{receipt.method?.replace('_', ' ')}</span>
              </div>
              {invoice?.invoice_number && (
                <div className="flex justify-between text-sm">
                  <span className="text-stone-500">Invoice</span>
                  <span className="text-stone-800 font-medium">#{invoice.invoice_number}</span>
                </div>
              )}
              {invoice?.total && (
                <div className="flex justify-between text-sm">
                  <span className="text-stone-500">Invoice total</span>
                  <span className="text-stone-800 font-medium">{fmtCurrency(invoice.total)}</span>
                </div>
              )}
            </div>

            {/* Balance status */}
            <div className="p-6">
              {isPaidInFull ? (
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-center">
                  <div className="text-sm font-semibold text-emerald-800">
                    This invoice is paid in full. Thank you!
                  </div>
                </div>
              ) : remaining !== null && remaining > 0.005 ? (
                <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-center">
                  <div className="text-sm text-amber-800">
                    Remaining balance: <strong>{fmtCurrency(remaining)}</strong>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div className="mt-6 text-center text-xs text-stone-400">
          Powered by{' '}
          <a href="https://timelyops.com" className="text-emerald-700 font-semibold hover:underline">
            TimelyOps
          </a>
        </div>
      </div>
    </div>
  )
}
