import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * DeliveryModal — shown before sending a quote, invoice, or receipt.
 * Presents available delivery options based on what contact info the client has.
 *
 * Props:
 *   client     — { email, phone, preferred_contact }
 *   publicUrl  — the shareable link for "Copy Link"
 *   label      — e.g. "Quote", "Invoice", "Receipt"
 *   sending    — loading state
 *   onEmail    — () => void
 *   onSms      — () => void
 *   onCopyLink — () => void
 *   onClose    — () => void
 */
export default function DeliveryModal({ client, publicUrl, label = 'Document', sending, onEmail, onSms, onCopyLink, onClose }) {
  const { t } = useTranslation()
  const preferred = client?.preferred_contact || 'sms'
  const hasEmail = !!client?.email
  const hasPhone = !!client?.phone

  function getInitialMethod() {
    // whatsapp / phone → copy link (no direct integration yet)
    if (preferred === 'whatsapp' || preferred === 'phone') {
      if (hasEmail) return 'email'
      if (hasPhone) return 'sms'
      return 'link'
    }
    if (preferred === 'email' && hasEmail) return 'email'
    if (preferred === 'sms' && hasPhone) return 'sms'
    // Fallback
    if (hasEmail) return 'email'
    if (hasPhone) return 'sms'
    return 'link'
  }

  const [method, setMethod] = useState(getInitialMethod)

  // Compute fallback note
  let fallbackNote = null
  if (preferred === 'email' && !hasEmail) fallbackNote = t('common.delivery.fallback_no_email')
  else if (preferred === 'sms' && !hasPhone) fallbackNote = t('common.delivery.fallback_no_phone')
  else if ((preferred === 'whatsapp' || preferred === 'phone') && !hasEmail && !hasPhone) fallbackNote = t('common.delivery.fallback_no_contact')

  function handleSend() {
    if (method === 'email') onEmail()
    else if (method === 'sms') onSms()
    else onCopyLink()
  }

  const sendLabel = sending
    ? t('common.delivery.sending')
    : method === 'link'
      ? t('common.delivery.copy_link')
      : method === 'email'
        ? t('common.delivery.send_via_email')
        : t('common.delivery.send_via_sms')

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-stone-900">{t('common.delivery.send_title', { label })}</h3>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:text-stone-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {fallbackNote && (
          <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            {fallbackNote}
          </div>
        )}

        <div className="space-y-2 mb-5">
          {hasEmail && (
            <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${method === 'email' ? 'border-emerald-600 bg-emerald-50' : 'border-stone-200 hover:border-stone-300'}`}>
              <input type="radio" name="delivery-method" value="email" checked={method === 'email'} onChange={() => setMethod('email')} className="accent-emerald-700" />
              <div>
                <div className="text-sm font-medium text-stone-800">{t('common.delivery.send_via_email')}</div>
                <div className="text-xs text-stone-400">{client.email}</div>
              </div>
            </label>
          )}
          {hasPhone && (
            <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${method === 'sms' ? 'border-emerald-600 bg-emerald-50' : 'border-stone-200 hover:border-stone-300'}`}>
              <input type="radio" name="delivery-method" value="sms" checked={method === 'sms'} onChange={() => setMethod('sms')} className="accent-emerald-700" />
              <div>
                <div className="text-sm font-medium text-stone-800">{t('common.delivery.send_via_sms')}</div>
                <div className="text-xs text-stone-400">{client.phone}</div>
              </div>
            </label>
          )}
          <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${method === 'link' ? 'border-emerald-600 bg-emerald-50' : 'border-stone-200 hover:border-stone-300'}`}>
            <input type="radio" name="delivery-method" value="link" checked={method === 'link'} onChange={() => setMethod('link')} className="accent-emerald-700" />
            <div>
              <div className="text-sm font-medium text-stone-800">{t('common.delivery.copy_link')}</div>
              <div className="text-xs text-stone-400">{t('common.delivery.copy_link_hint')}</div>
            </div>
          </label>
        </div>

        <button
          onClick={handleSend}
          disabled={sending}
          className="w-full py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 transition-colors"
        >
          {sendLabel}
        </button>
      </div>
    </div>
  )
}
