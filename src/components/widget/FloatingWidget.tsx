import { useState } from 'react'
import ChatWidget, { DEFAULT_WIDGET } from './ChatWidget'
import { MessageSquare, X } from 'lucide-react'

/** The live widget, presented on the marketing site itself. */
export default function FloatingWidget() {
  const [open, setOpen] = useState(false)

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="h-[540px] w-[min(380px,calc(100vw-40px))]">
          <ChatWidget config={{ ...DEFAULT_WIDGET, agentName: 'OpenMind Demo' }} />
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="flex h-14 w-14 items-center justify-center border border-primary bg-accent text-white hard-shadow transition-transform hover:scale-105"
        aria-label={open ? 'Close chat' : 'Open chat'}
      >
        {open ? <X className="h-6 w-6" /> : <MessageSquare className="h-6 w-6" />}
      </button>
    </div>
  )
}
