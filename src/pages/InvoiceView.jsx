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

const STATUS_STYLES = {
  draft:    'bg-stone-100 text-stone-600',
  sent:     'bg-blue-50 text-blue-700',
  paid:     'bg-emerald-50 text-emerald-700',
  overdue:  'bg-red-50 text-red-700',
  void:     'bg-stone-100 text-stone-500',
}

export default function InvoiceView() {
  const { token } = useParams()
  const [state, setState] = useState('loading') // loading | not_found | loaded
  const [invoice, setInvoice] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase.functions.invoke('quote-action', {
          body: { action: 'get_invoice', token },
        })
        if (error || !data?.invoice) { setState('not_found'); return }
        setInvoice(data.invoice)
        setState('loaded')
      } catch {
        setState('not_found')
      }
    }
    load()
  }, [token])

  const lineItems = invoice?.invoice_line_items?.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) ?? []
  const org = invoice?.organizations
  const client = invoice?.clients

  return (
    <div className="min-h-screen bg-stone-100 py-10 px-4">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        {org && (
          <div className="mb-6 text-center">
            <div className="text-sm text-stone-500">Invoice from</div>
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
            <div className="font-semibold text-stone-800 mb-2">Invoice not found</div>
            <div className="text-sm text-stone-500">This link may be invalid or expired.</div>
          </div>
        )}

        {/* Loaded */}
        {state === 'loaded' && invoice && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {/* Invoice meta */}
            <div className="p-6 border-b border-stone-100">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs text-stone-400 uppercase tracking-wide mb-1">Invoice</div>
                  <div className="text-2xl font-bold text-stone-900">#{invoice.invoice_number}</div>
                  {client && <div className="text-sm text-stone-500 mt-1">Billed to {client.name}</div>}
                </div>
                <div className="text-right space-y-1.5">
                  <div>
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[invoice.status] ?? STATUS_STYLES.draft}`}>
                      {invoice.status}
                    </span>
                  </div>
                  {invoice.issue_date && (
                    <div className="text-xs text-stone-400">Issued {fmtDate(invoice.issue_date)}</div>
                  )}
                  {invoice.due_date && (
                    <div className="text-xs text-stone-500 font-medium">Due {fmtDate(invoice.due_date)}</div>
                  )}
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
                  <span>{fmtCurrency(invoice.subtotal)}</span>
                </div>
                {invoice.tax_rate > 0 && (
                  <div className="flex justify-between text-stone-500">
                    <span>Tax ({invoice.tax_rate}%)</span>
                    <span>{fmtCurrency(invoice.tax_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-stone-900 text-base pt-1 border-t border-stone-200">
                  <span>Total</span>
                  <span>{fmtCurrency(invoice.total)}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {invoice.notes && (
              <div className="px-6 py-4 border-b border-stone-100">
                <div className="text-xs text-stone-400 uppercase tracking-wide mb-1">Notes</div>
                <div className="text-sm text-stone-600 whitespace-pre-line">{invoice.notes}</div>
              </div>
            )}

            {/* Pay now placeholder */}
            {invoice.status !== 'paid' && invoice.status !== 'void' && (
              <div className="p-6">
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-center">
                  <div className="text-sm font-semibold text-emerald-800 mb-1">Ready to pay?</div>
                  <div className="text-sm text-emerald-700">
                    Contact{org ? ` ${org.name}` : ' us'} to arrange payment.
                    {org?.email && (
                      <span> <a href={`mailto:${org.email}`} className="underline">{org.email}</a></span>
                    )}
                    {org?.phone && (
                      <span> · <a href={`tel:${org.phone}`} className="underline">{org.phone}</a></span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {invoice.status === 'paid' && (
              <div className="p-6">
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-center">
                  <div className="text-sm font-semibold text-emerald-800">This invoice has been paid. Thank you!</div>
                </div>
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
