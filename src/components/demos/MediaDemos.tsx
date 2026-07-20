import { useEffect, useRef, useState } from 'react'
import { Pane, RunButton, ModeStamp, Field, inputCls, selectCls } from './shared'
import { paintProcedural } from '@/lib/demo'
import { Mic, Volume2 } from 'lucide-react'

// ── 02 · Image Generation (procedural preview) ───────────────────────────────

export function ImageDemo() {
  const [prompt, setPrompt] = useState('a brutalist poster for an open-source ai stack')
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const run = () => {
    if (busy || !canvasRef.current) return
    setBusy(true)
    // fake "rendering" delay for drama, then paint
    setTimeout(() => {
      paintProcedural(canvasRef.current!, prompt)
      setBusy(false)
    }, 700)
  }

  useEffect(() => {
    paintProcedural(canvasRef.current!, prompt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <ModeStamp mode="simulated" note="deterministic procedural preview — live mode renders via your provider" />
        <Field label="Prompt">
          <textarea className={inputCls + ' min-h-24 resize-y'} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </Field>
        <RunButton onClick={run} running={busy} label="Generate" stopLabel="Rendering…" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Same prompt → same seed → same image. In production the request routes to FLUX, SDXL or
          DALL·E under your key; here a local painter demonstrates the pipeline deterministically.
        </p>
      </div>
      <Pane title="render — 640×400" right={<span className="font-mono-spec text-[10px] text-white/40">{busy ? 'sampling…' : 'done'}</span>}>
        <canvas ref={canvasRef} className={`w-full border border-white/15 transition-opacity ${busy ? 'opacity-30' : 'opacity-100'}`} />
      </Pane>
    </div>
  )
}

// ── 03 · Speech-to-Text (real, browser SpeechRecognition) ────────────────────

declare global {
  interface Window {
    SpeechRecognition?: any
    webkitSpeechRecognition?: any
  }
}

export function SttDemo() {
  const SR = typeof window !== 'undefined' ? window.SpeechRecognition ?? window.webkitSpeechRecognition : undefined
  const [supported] = useState(Boolean(SR))
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const recRef = useRef<any>(null)

  const toggle = () => {
    if (!supported) return
    if (listening) {
      recRef.current?.stop()
      return
    }
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = (e: any) => {
      let final = ''
      let inter = ''
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + ' '
        else inter += e.results[i][0].transcript
      }
      if (final) setTranscript((t) => (t + ' ' + final).trim())
      setInterim(inter)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    rec.start()
    recRef.current = rec
    setListening(true)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        {supported ? (
          <ModeStamp mode="live" note="browser SpeechRecognition — no key, no server" />
        ) : (
          <ModeStamp mode="simulated" note="this browser lacks SpeechRecognition — try Chrome" />
        )}
        <p className="text-sm leading-relaxed text-muted-foreground">
          Press the mic and speak. The words below are transcribed on-device by your browser —
          the same streaming UX your users get when the widget routes to Whisper under your key.
        </p>
        <RunButton
          onClick={toggle}
          running={listening}
          label={supported ? 'Start listening' : 'Not supported here'}
          stopLabel="Stop"
          disabled={!supported}
        />
        {listening && (
          <p className="flex items-center gap-2 font-mono-spec text-xs uppercase tracking-[0.14em] text-accent">
            <Mic className="h-4 w-4" /> recording… speak now
          </p>
        )}
      </div>
      <Pane title="transcript — stream" right={listening ? <span className="font-mono-spec text-[10px] text-accent">● rec</span> : undefined}>
        {transcript || interim ? (
          <>
            {transcript} <span className="text-white/45">{interim}</span>
          </>
        ) : (
          <span className="text-white/35">// your speech appears here, word by word…</span>
        )}
      </Pane>
    </div>
  )
}

// ── 04 · Text-to-Speech (real, browser speechSynthesis) ─────────────────────

export function TtsDemo() {
  const [text, setText] = useState('Your models. Your keys. One open stack — running entirely on infrastructure you control.')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voice, setVoice] = useState('')
  const [rate, setRate] = useState(1)
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    const load = () => {
      const v = window.speechSynthesis?.getVoices() ?? []
      setVoices(v.filter((x) => x.lang.startsWith('en')).slice(0, 12))
      if (v.length && !voice) setVoice(v[0].name)
    }
    load()
    window.speechSynthesis?.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = () => {
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    const u = new SpeechSynthesisUtterance(text)
    const v = voices.find((x) => x.name === voice)
    if (v) u.voice = v
    u.rate = rate
    u.onend = () => setSpeaking(false)
    window.speechSynthesis.speak(u)
    setSpeaking(true)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <ModeStamp mode="live" note="browser speechSynthesis — no key, no server" />
        <Field label="Text to speak">
          <textarea className={inputCls + ' min-h-24 resize-y'} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Voice">
            <select className={selectCls} value={voice} onChange={(e) => setVoice(e.target.value)}>
              {voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </Field>
          <Field label={`Rate — ${rate.toFixed(1)}×`}>
            <input
              type="range" min={0.5} max={1.8} step={0.1} value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              className="mt-3 w-full accent-[#ff4d00]"
            />
          </Field>
        </div>
        <RunButton onClick={toggle} running={speaking} label="Speak" stopLabel="Stop" />
      </div>
      <Pane title="audio — output">
        <div className="flex h-40 items-center justify-center">
          {speaking ? (
            <div className="flex items-end gap-1.5">
              {Array.from({ length: 24 }).map((_, i) => (
                <span
                  key={i}
                  className="w-1.5 bg-accent"
                  style={{
                    animation: `pulse-dot ${0.5 + (i % 5) * 0.13}s ease-in-out infinite`,
                    height: `${12 + ((i * 37) % 52)}px`,
                  }}
                />
              ))}
            </div>
          ) : (
            <span className="flex items-center gap-2 text-white/35">
              <Volume2 className="h-4 w-4" /> press speak — audio plays from your device
            </span>
          )}
        </div>
      </Pane>
    </div>
  )
}
