import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function renderInline(text) {
  const parts = []
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g
  let last = 0, m, k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[1] != null) parts.push(<strong key={k++}>{m[1]}</strong>)
    else parts.push(<em key={k++}>{m[2]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function renderMarkdown(text) {
  return text.split(/\n{2,}/).map((block, bi) => {
    const lines = block.split('\n')
    const bulletLines = lines.filter(l => l.trim())
    if (bulletLines.length > 0 && bulletLines.every(l => /^[-•*]\s+/.test(l.trim()))) {
      return (
        <ul key={bi} className={`list-disc pl-4 space-y-0.5${bi > 0 ? ' mt-2' : ''}`}>
          {bulletLines.map((item, ii) => (
            <li key={ii}>{renderInline(item.replace(/^[-•*]\s+/, ''))}</li>
          ))}
        </ul>
      )
    }
    return (
      <p key={bi} className={bi > 0 ? 'mt-2' : ''}>
        {lines.map((line, li) => (
          <span key={li}>{li > 0 && <br />}{renderInline(line)}</span>
        ))}
      </p>
    )
  })
}

export default function BookingPage() {
  const { slug } = useParams()
  const [pageState, setPageState] = useState('loading') // loading | not_found | chat | confirmed
  const [orgName, setOrgName] = useState('')
  const [messages, setMessages] = useState([]) // [{ role: 'user'|'assistant', content }]
  const [conversationId, setConversationId] = useState(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // Validate that the org exists and has the booking agent enabled
  useEffect(() => {
    async function init() {
      // Send an empty probe — the Edge Function will either return 404/403 or start the chat
      // Instead, just check org name via a lightweight Supabase query using anon key
      // (slug is public — no sensitive data exposed)
      const { data: org } = await supabase
        .from('organizations')
        .select('name, subscription_tier, add_ons')
        .eq('slug', slug)
        .maybeSingle()

      if (!org) {
        setPageState('not_found')
        return
      }

      // Check feature client-side (mirrors Edge Function check)
      const tierFeatures = {
        growth: ['ai_lead_agents', 'client_booking_portal', 'quickbooks_sync', 'supply_tracking'],
      }
      const addOns = Array.isArray(org.add_ons) ? org.add_ons : []
      const tierHas = (tierFeatures[org.subscription_tier] || []).includes('ai_lead_agents')
      const addonHas = addOns.includes('ai_lead_agents')

      if (!tierHas && !addonHas) {
        setPageState('not_found')
        return
      }

      setOrgName(org.name)
      setPageState('chat')

      // Send a welcome prompt to get the first assistant message
      await sendMessage('Hello', null, true)
    }
    init()
  }, [slug])

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  async function sendMessage(text, convId = conversationId, isInit = false) {
    if (!isInit) setSending(true)
    setError(null)

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('booking-agent', {
        body: {
          org_slug: slug,
          conversation_id: convId,
          message: text,
        },
      })

      if (fnErr || data?.error) {
        setError(data?.error || 'Something went wrong. Please try again.')
        return
      }

      if (!conversationId && data.conversation_id) {
        setConversationId(data.conversation_id)
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }])

      if (data.job_created) {
        // Give the customer a moment to read the final message, then show confirmation
        setTimeout(() => setPageState('confirmed'), 1800)
      }
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      if (!isInit) setSending(false)
      inputRef.current?.focus()
    }
  }

  function handleSend() {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setSending(true)
    sendMessage(text).finally(() => setSending(false))
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Loading ──────────────────────────────────────────────────────
  if (pageState === 'loading') {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center">
        <div className="text-stone-400">Loading…</div>
      </div>
    )
  }

  // ── Not found / not enabled ──────────────────────────────────────
  if (pageState === 'not_found') {
    return (
      <div className="min-h-screen bg-stone-100 py-10 px-4">
        <div className="max-w-lg mx-auto">
          <div className="bg-white rounded-2xl shadow-sm p-10 text-center">
            <div className="text-4xl mb-4">🔍</div>
            <div className="font-semibold text-stone-800 mb-2">Booking not available</div>
            <div className="text-sm text-stone-500">
              This link doesn't match an active booking page. Please contact the business directly.
            </div>
          </div>
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

  // ── Confirmed ────────────────────────────────────────────────────
  if (pageState === 'confirmed') {
    return (
      <div className="min-h-screen bg-stone-100 py-10 px-4">
        <div className="max-w-lg mx-auto">
          {orgName && (
            <div className="mb-6 text-center">
              <div className="text-sm text-stone-500">Booking with</div>
              <div className="text-xl font-bold text-stone-900">{orgName}</div>
            </div>
          )}
          <div className="bg-white rounded-2xl shadow-sm p-10 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="font-semibold text-stone-800 mb-2">Booking request submitted!</div>
            <div className="text-sm text-stone-500">
              {orgName
                ? `${orgName} will review your request and confirm shortly.`
                : 'The team will review your request and confirm shortly.'}
            </div>
          </div>
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

  // ── Chat ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-100 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-4 py-4 text-center">
        <div className="text-xs text-stone-400 mb-0.5">Book a service with</div>
        <div className="font-bold text-stone-900 text-lg">{orgName}</div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-lg mx-auto w-full">
        {messages.length === 0 && !sending && (
          <div className="text-center text-stone-400 text-sm mt-8">Starting conversation…</div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`mb-3 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : 'bg-white text-stone-800 shadow-sm rounded-bl-sm'
              }`}
            >
              {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {sending && (
          <div className="mb-3 flex justify-start">
            <div className="bg-white shadow-sm rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1 items-center">
              <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {error && (
          <div className="mb-3 mx-1 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="bg-white border-t border-stone-200 px-4 py-3 max-w-lg mx-auto w-full">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            className="flex-1 resize-none border border-stone-200 rounded-xl px-3 py-2.5 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent max-h-32"
            placeholder="Type a message…"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="flex-shrink-0 w-10 h-10 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        </div>
        <div className="mt-1.5 text-center text-xs text-stone-400">
          Powered by{' '}
          <a href="https://timelyops.com" className="text-emerald-700 hover:underline">TimelyOps</a>
        </div>
      </div>
    </div>
  )
}
