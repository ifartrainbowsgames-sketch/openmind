/** OpenAI speech — Whisper STT + TTS voices for mobile /app. Keys stay in the browser. */

export const OPENAI_TTS_VOICES = [
  'alloy',
  'ash',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
] as const

export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number]

export const MOBILE_VOICE_SETTINGS_KEY = 'openmind-mobile-voice-v1'

export interface MobileVoiceSettings {
  voice: OpenAiTtsVoice
  autoSpeak: boolean
}

export const DEFAULT_MOBILE_VOICE: MobileVoiceSettings = {
  voice: 'nova',
  autoSpeak: true,
}

export function loadMobileVoiceSettings(): MobileVoiceSettings {
  if (typeof window === 'undefined') return DEFAULT_MOBILE_VOICE
  try {
    const raw = localStorage.getItem(MOBILE_VOICE_SETTINGS_KEY)
    if (!raw) return DEFAULT_MOBILE_VOICE
    const parsed = JSON.parse(raw) as Partial<MobileVoiceSettings>
    const voice = OPENAI_TTS_VOICES.includes(parsed.voice as OpenAiTtsVoice)
      ? (parsed.voice as OpenAiTtsVoice)
      : DEFAULT_MOBILE_VOICE.voice
    return { voice, autoSpeak: parsed.autoSpeak ?? DEFAULT_MOBILE_VOICE.autoSpeak }
  } catch {
    return DEFAULT_MOBILE_VOICE
  }
}

export function saveMobileVoiceSettings(settings: MobileVoiceSettings): void {
  localStorage.setItem(MOBILE_VOICE_SETTINGS_KEY, JSON.stringify(settings))
}

/** Strip markdown-ish noise so TTS sounds natural. */
export function textForSpeech(input: string, maxLength = 4096): string {
  const clean = input
    .replace(/```[\s\S]*?```/g, ' code block omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, maxLength - 1).trimEnd()}…`
}

export async function transcribeOpenAi(apiKey: string, audio: Blob): Promise<string> {
  const body = new FormData()
  body.append('file', audio, 'speech.webm')
  body.append('model', 'whisper-1')
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  })
  if (!res.ok) {
    throw new Error(`Transcription failed (${res.status})`)
  }
  const data = (await res.json()) as { text?: string }
  return (data.text ?? '').trim()
}

export async function synthesizeOpenAi(
  apiKey: string,
  text: string,
  voice: OpenAiTtsVoice = 'nova',
): Promise<Blob> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice,
      input: textForSpeech(text),
      response_format: 'mp3',
    }),
  })
  if (!res.ok) {
    // Fall back to classic TTS if mini-tts unavailable on the account
    const fallback = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice,
        input: textForSpeech(text),
        response_format: 'mp3',
      }),
    })
    if (!fallback.ok) throw new Error(`Speech synthesis failed (${fallback.status})`)
    return fallback.blob()
  }
  return res.blob()
}

let activeAudio: HTMLAudioElement | null = null

export function stopOpenAiSpeech(): void {
  if (!activeAudio) return
  activeAudio.pause()
  activeAudio.src = ''
  activeAudio = null
}

export async function playOpenAiSpeech(
  apiKey: string,
  text: string,
  voice: OpenAiTtsVoice = 'nova',
): Promise<void> {
  stopOpenAiSpeech()
  const blob = await synthesizeOpenAi(apiKey, text, voice)
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  activeAudio = audio
  await new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(url)
      if (activeAudio === audio) activeAudio = null
      resolve()
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not play speech audio'))
    }
    void audio.play().catch(reject)
  })
}

export async function recordMicrophone(maxMs = 60_000): Promise<{ stop: () => void; done: Promise<Blob> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream)
  const chunks: BlobPart[] = []

  const done = new Promise<Blob>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop()
    }, maxMs)

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onerror = () => {
      window.clearTimeout(timeout)
      stream.getTracks().forEach((t) => t.stop())
      reject(new Error('Microphone recording failed'))
    }
    recorder.onstop = () => {
      window.clearTimeout(timeout)
      stream.getTracks().forEach((t) => t.stop())
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
    }
    recorder.start()
  })

  return {
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop()
    },
    done,
  }
}
