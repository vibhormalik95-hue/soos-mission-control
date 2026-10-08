'use client'

import { useCallback, useEffect, useRef, useState, FormEvent } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { LanguageSwitcherSelect } from '@/components/ui/language-switcher'
import { apiFetch } from '@/lib/api-client'
import { STORAGE_GATEWAY_URL } from '@/lib/device-identity'

interface GoogleCredentialResponse {
  credential?: string
}

interface GoogleAccountsIdApi {
  initialize(config: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
  }): void
  renderButton(
    parent: HTMLElement,
    options?: {
      type?: 'standard' | 'icon'
      theme?: 'outline' | 'filled_blue' | 'filled_black'
      size?: 'large' | 'medium' | 'small'
      text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
      shape?: 'rectangular' | 'pill' | 'circle' | 'square'
      width?: number
    },
  ): void
}

interface GoogleApi {
  accounts: {
    id: GoogleAccountsIdApi
  }
}

type LoginRequestBody =
  | { username: string; password: string }
  | { credential?: string }

type LoginErrorPayload = {
  code?: string
  error?: string
  hint?: string
}

function readLoginErrorPayload(value: unknown): LoginErrorPayload {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
    hint: typeof record.hint === 'string' ? record.hint : undefined,
  }
}

declare global {
  interface Window {
    google?: GoogleApi
  }
}

const GATEWAY_URL_PRESETS = [
  'ws://127.0.0.1:18789',
  'wss://127.0.0.1:18789',
  'ws://localhost:18789',
  'wss://localhost:18789',
  'wss://gateway:18789',
]

const GATEWAY_CONNECTION_TIMEOUT_MS = 5000

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'failed'

export default function LoginPage() {
  const t = useTranslations('auth')
  const tc = useTranslations('common')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pendingApproval, setPendingApproval] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleReady, setGoogleReady] = useState(false)
  const googleCallbackRef = useRef<((response: GoogleCredentialResponse) => void) | null>(null)
  const googleButtonRef = useRef<HTMLDivElement | null>(null)

  // Advanced settings state
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [gatewayPreset, setGatewayPreset] = useState<string>(() => {
    // Auto-select wss:// preset when the page is served over HTTPS (reverse proxy)
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      return 'wss://127.0.0.1:18789'
    }
    return 'ws://127.0.0.1:18789'
  })
  const [gatewayCustom, setGatewayCustom] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')
  const [connectionError, setConnectionError] = useState('')

  // Initialize gateway URL from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_GATEWAY_URL)
    if (saved) {
      if (GATEWAY_URL_PRESETS.includes(saved)) {
        setGatewayPreset(saved)
      } else {
        setGatewayPreset('custom')
        setGatewayCustom(saved)
      }
    }
  }, [])

  const getEffectiveGatewayUrl = (): string => {
    return gatewayPreset === 'custom' ? gatewayCustom.trim() : gatewayPreset
  }

  const handleGatewayUrlChange = (value: string) => {
    setGatewayPreset(value)
    if (value !== 'custom') {
      localStorage.setItem(STORAGE_GATEWAY_URL, value)
      setConnectionStatus('idle')
    }
  }

  const handleGatewayCustomChange = (value: string) => {
    setGatewayCustom(value)
    const trimmed = value.trim()
    if (trimmed) {
      localStorage.setItem(STORAGE_GATEWAY_URL, trimmed)
      setConnectionStatus('idle')
    }
  }

  const handleTestConnection = () => {
    const url = getEffectiveGatewayUrl()
    if (!url) return
    setConnectionStatus('testing')
    setConnectionError('')

    return new Promise<void>((resolve) => {
      try {
        const ws = new WebSocket(url)
        const timeout = setTimeout(() => {
          ws.close()
          setConnectionStatus('failed')
          setConnectionError('Connection timed out')
          resolve()
        }, GATEWAY_CONNECTION_TIMEOUT_MS)

        ws.onopen = () => {
          clearTimeout(timeout)
          ws.close()
          setConnectionStatus('success')
          resolve()
        }

        ws.onerror = () => {
          clearTimeout(timeout)
          ws.close()
          setConnectionStatus('failed')
          setConnectionError('Could not connect')
          resolve()
        }
      } catch {
        setConnectionStatus('failed')
        setConnectionError('Invalid URL')
        resolve()
      }
    })
  }

  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''

  // Check if first-time setup is needed on page load — auto-redirect to /setup
  useEffect(() => {
    apiFetch<{ needsSetup?: boolean }>('/api/setup', {
      redirectOnUnauthenticated: false,
    })
      .then((data) => {
        if (data.needsSetup) {
          window.location.href = '/setup'
        }
      })
      .catch(() => {
        // Ignore — setup check is best-effort
      })
  }, [])

  const completeLogin = useCallback(async (path: string, body: LoginRequestBody) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const data = readLoginErrorPayload(await res.json().catch(() => null))
      if (data.code === 'PENDING_APPROVAL') {
        setPendingApproval(true)
        setNeedsSetup(false)
        setError('')
        setLoading(false)
        setGoogleLoading(false)
        return false
      }
      if (data.code === 'NO_USERS') {
        setNeedsSetup(true)
        setError('')
        setLoading(false)
        setGoogleLoading(false)
        return false
      }
      setError(data.error || t('loginFailed'))
      setPendingApproval(false)
      setNeedsSetup(false)
      setLoading(false)
      setGoogleLoading(false)
      return false
    }

    // Full reload ensures the session cookie is sent on all subsequent requests.
    // router.push() + refresh() can race and use stale RSC payloads.
    window.location.href = '/'
    return true
  }, [t])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Read DOM values directly to handle browser autofill (which doesn't fire onChange)
    const form = e.target as HTMLFormElement
    const formUsername = (form.elements.namedItem('username') as HTMLInputElement)?.value || username
    const formPassword = (form.elements.namedItem('password') as HTMLInputElement)?.value || password

    try {
      await completeLogin('/api/auth/login', { username: formUsername, password: formPassword })
    } catch {
      setError(t('networkError'))
      setLoading(false)
    }
  }

  // Initialize Google Sign-In SDK and render Google's own sign-in button.
  // NOTE: the button must be rendered via renderButton — calling prompt() (One Tap)
  // from a click handler silently no-ops when third-party cookies are blocked,
  // on mobile, or after a dismissal, which made the button appear dead.
  useEffect(() => {
    if (!googleClientId) return

    const onScriptLoad = () => {
      if (!window.google) return
      googleCallbackRef.current = async (response: GoogleCredentialResponse) => {
        setError('')
        setGoogleLoading(true)
        try {
          const ok = await completeLogin('/api/auth/google', { credential: response?.credential })
          if (!ok) return
        } catch {
          setError(t('googleSignInFailed'))
          setGoogleLoading(false)
        }
      }
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response: GoogleCredentialResponse) => googleCallbackRef.current?.(response),
      })
      if (googleButtonRef.current) {
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          width: 320,
        })
      }
      setGoogleReady(true)
    }

    const existing = document.querySelector('script[data-google-gsi="1"]') as HTMLScriptElement | null
    if (existing) {
      if (window.google) onScriptLoad()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.setAttribute('data-google-gsi', '1')
    script.onload = onScriptLoad
    script.onerror = () => setError(t('googleSignInFailed'))
    document.head.appendChild(script)
  }, [googleClientId, completeLogin, t])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcherSelect />
      </div>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-lg overflow-hidden bg-background border border-border/50 flex items-center justify-center mb-3">
            <Image
              src="/brand/mc-logo-128.png"
              alt="Mission Control logo"
              width={48}
              height={48}
              className="h-full w-full object-cover"
              priority
            />
          </div>
          <h1 className="text-xl font-semibold text-foreground">{t('missionControl')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('signInToContinue')}</p>
        </div>

        {pendingApproval && (
          <div className="mb-4 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-center">
            <div className="flex justify-center mb-2">
              <svg className="w-8 h-8 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12,6 12,12 16,14" />
              </svg>
            </div>
            <div className="text-sm font-medium text-amber-200">{t('accessRequestSubmitted')}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('accessRequestDescription')}
            </p>
            <Button
              onClick={() => { setPendingApproval(false); setError(''); setGoogleLoading(false) }}
              variant="ghost"
              size="sm"
              className="mt-3 text-xs"
            >
              {t('tryAgain')}
            </Button>
          </div>
        )}

        {needsSetup && (
          <div className="mb-4 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-center">
            <div className="flex justify-center mb-2">
              <svg className="w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="text-sm font-medium text-blue-200">{t('noAdminAccount')}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('noAdminDescription')}
            </p>
            <Button
              onClick={() => { window.location.href = '/setup' }}
              size="sm"
              className="mt-3"
            >
              {t('createAdminAccount')}
            </Button>
          </div>
        )}

        {error && (
          <div role="alert" className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Advanced Settings — WebSocket gateway URL configuration */}
        <div className="mb-4 rounded-lg border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setAdvancedOpen(o => !o)}
            className="w-full px-3 py-2 flex items-center justify-between text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          >
            <span>{t('advancedSettings')}</span>
            <svg
              className={`w-4 h-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>

          {advancedOpen && (
            <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border">
              <div>
                <label htmlFor="gateway-url" className="block text-sm font-medium text-foreground mb-1.5">
                  {t('gatewayUrl')}
                </label>
                <div className="flex gap-2">
                  <select
                    id="gateway-url"
                    value={gatewayPreset}
                    onChange={e => handleGatewayUrlChange(e.target.value)}
                    className="flex-1 h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/50 focus:border-primary transition-smooth appearance-none cursor-pointer"
                  >
                    {GATEWAY_URL_PRESETS.map(url => (
                      <option key={url} value={url}>{url}</option>
                    ))}
                    <option value="custom">Custom</option>
                  </select>
                </div>
                {gatewayPreset === 'custom' && (
                  <input
                    type="text"
                    value={gatewayCustom}
                    onChange={e => handleGatewayCustomChange(e.target.value)}
                    placeholder={t('gatewayUrlPlaceholder')}
                    className="mt-2 w-full h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/50 focus:border-primary transition-smooth"
                  />
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={connectionStatus === 'testing' || !getEffectiveGatewayUrl()}
                  className="h-9 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm hover:bg-muted-foreground/10 focus:outline-hidden focus:ring-2 focus:ring-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {connectionStatus === 'testing' ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-muted-foreground/40 border-t-muted-foreground rounded-full animate-spin" />
                      {t('testConnection')}...
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M13.5 2.5L2.5 13.5M13.5 2.5l-4 4m4-4l-4-4m4 4l-4 4" />
                      </svg>
                      {t('testConnection')}
                    </>
                  )}
                </button>

                {connectionStatus === 'success' && (
                  <span className="text-xs text-green-500 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 3L6 10l-3-3" />
                    </svg>
                    {t('connectionSuccess')}
                  </span>
                )}
                {connectionStatus === 'failed' && (
                  <span className="text-xs text-destructive flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 4L4 12M4 4l8 8" />
                    </svg>
                    {t('connectionFailed')}{connectionError ? `: ${connectionError}` : ''}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Google Sign-In button — shown only when client ID is configured.
            Rendered by Google Identity Services (renderButton), not a custom
            button calling prompt(), so the click reliably opens the account chooser. */}
        {googleClientId && (
          <div className={pendingApproval ? 'opacity-50 pointer-events-none' : ''}>
            <div ref={googleButtonRef} className="flex justify-center min-h-10" />
            {googleLoading && (
              <p className="text-center text-xs text-muted-foreground mt-2">{t('signingIn')}</p>
            )}
            {!googleReady && (
              <p className="text-center text-xs text-muted-foreground mt-2">{t('loadingGoogleSignIn')}</p>
            )}

            {/* Divider */}
            <div className="my-4 flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">{tc('or')}</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className={`space-y-4 ${pendingApproval ? 'opacity-50 pointer-events-none' : ''}`}>
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-foreground mb-1.5">{t('username')}</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/50 focus:border-primary transition-smooth"
              placeholder={t('enterUsername')}
              autoComplete="username"
              autoFocus
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">{t('password')}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/50 focus:border-primary transition-smooth"
              placeholder={t('enterPassword')}
              autoComplete="current-password"
              required
              aria-required="true"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            size="lg"
            className="w-full rounded-lg"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                {t('signingIn')}
              </>
            ) : (
              t('signIn')
            )}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">{t('orchestrationTagline')}</p>
      </div>
    </div>
  )
}
