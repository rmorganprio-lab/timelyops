import { createContext, useContext, useState, useCallback } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  // showToast(message, type?, action?)
  // action = { label: string, onClick: () => void }
  const showToast = useCallback((message, type = 'success', action = null) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type, action }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }, [])

  function dismiss(id) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-xs flex items-center gap-3 ${
                t.type === 'error' ? 'bg-red-700 text-white' : 'bg-stone-900 text-white'
              }`}
            >
              <span className="flex-1">{t.message}</span>
              {t.action && (
                <button
                  onClick={() => { t.action.onClick(); dismiss(t.id) }}
                  className="shrink-0 underline text-white/80 hover:text-white text-xs font-semibold"
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
