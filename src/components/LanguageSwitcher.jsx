import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
]

export default function LanguageSwitcher({ className = '' }) {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const current = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0]

  function switchTo(lang) {
    i18n.changeLanguage(lang)
    localStorage.setItem('timelyops_language', lang)
    setOpen(false)
  }

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 transition-colors"
      >
        {current.code.toUpperCase()}
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full mb-1 left-0 bg-white border border-stone-200 rounded-xl shadow-lg py-1 min-w-[110px] z-50">
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              onClick={() => switchTo(lang.code)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                lang.code === current.code
                  ? 'text-emerald-700 font-semibold bg-emerald-50'
                  : 'text-stone-600 hover:bg-stone-50'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
