'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

/**
 * Command view — the operator's single screen.
 *
 * Vision: one page, no scrolling through sections, every pixel earning its
 * place. One glance shows all live work; the operator steers from the same
 * page. Live tasks are the hero (not empty fleet cards); the activity stream
 * and the steer bar complete the loop.
 */

interface LiveTask {
  id: number
  title: string
  status: string
  assigned_to?: string
  created_at: number
  updated_at: number
  step: string
  stepAt: number
}

interface FeedItem {
  id: string
  taskTitle: string
  author: string
  content: string
  at: number
}

const LIVE_STATUSES = new Set(['in_progress', 'review', 'quality_review'])

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function statusColor(status: string): string {
  switch (status) {
    case 'in_progress':
      return 'bg-amber-400'
    case 'review':
    case 'quality_review':
      return 'bg-sky-400'
    case 'done':
      return 'bg-emerald-400'
    case 'failed':
      return 'bg-red-400'
    default:
      return 'bg-zinc-500'
  }
}

export function Dashboard() {
  const [tasks, setTasks] = useState<LiveTask[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [agents, setAgents] = useState(0)
  const [clock, setClock] = useState('')
  const [steerTask, setSteerTask] = useState<string>('')
  const [steerMsg, setSteerMsg] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    try {
      const [taskData, agentData] = await Promise.all([
        apiFetch<{ tasks?: any[] }>('/api/tasks?limit=100'),
        apiFetch<{ agents?: any[] }>('/api/agents').catch(() => ({ agents: [] as any[] })),
      ])
      const live = (taskData.tasks || []).filter((t) => LIVE_STATUSES.has(t.status))
      setAgents((agentData.agents || []).length)

      const enriched = await Promise.all(
        live.map(async (t) => {
          let step = 'working…'
          let stepAt = t.updated_at || t.created_at || 0
          let comments: any[] = []
          try {
            const c = await apiFetch<{ comments?: any[] }>(`/api/tasks/${t.id}/comments`)
            comments = c.comments || []
            const last = comments[comments.length - 1]
            if (last) {
              step = String(last.content || 'working…').slice(0, 160)
              stepAt = last.created_at || stepAt
            }
          } catch {
            /* comments are best-effort */
          }
          return {
            task: {
              id: t.id,
              title: String(t.title || 'Untitled'),
              status: t.status,
              assigned_to: t.assigned_to,
              created_at: t.created_at || 0,
              updated_at: t.updated_at || 0,
              step,
              stepAt,
            } as LiveTask,
            comments,
          }
        }),
      )
      const sorted = enriched.map((e) => e.task).sort((a, b) => b.stepAt - a.stepAt)
      setTasks(sorted)

      const items: FeedItem[] = []
      for (const { task, comments } of enriched) {
        for (const c of comments.slice(-6)) {
          items.push({
            id: `${task.id}-${c.id ?? c.created_at}`,
            taskTitle: task.title,
            author: String(c.author || ''),
            content: String(c.content || '').slice(0, 220),
            at: c.created_at || 0,
          })
        }
      }
      items.sort((a, b) => b.at - a.at)
      setFeed(items.slice(0, 40))
    } catch {
      /* keep last good state on poll failure */
    }
  }, [])

  useEffect(() => {
    load()
    const i = setInterval(load, 10000)
    return () => clearInterval(i)
  }, [load])

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    tick()
    const i = setInterval(tick, 15000)
    return () => clearInterval(i)
  }, [])

  const send = useCallback(async () => {
    if (!steerTask || !steerMsg.trim() || sending) return
    setSending(true)
    try {
      await apiFetch(`/api/tasks/${steerTask}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: steerMsg.trim() }),
      })
      setSteerMsg('')
      load()
    } catch {
      /* surface nothing — the next poll recovers */
    } finally {
      setSending(false)
    }
  }, [steerTask, steerMsg, sending, load])

  return (
    <div className="flex flex-col gap-3 h-[calc(100dvh-190px)] min-h-[520px] overflow-hidden">
      {/* status strip */}
      <div className="flex items-center gap-4 px-4 h-10 shrink-0 rounded-lg border border-border bg-card text-sm">
        <span className="flex items-center gap-2 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          LIVE
        </span>
        <span className="font-mono tabular-nums">
          {tasks.length} running
        </span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {agents} agents
        </span>
        <span className="ml-auto font-mono tabular-nums text-muted-foreground">{clock}</span>
      </div>

      {/* main grid */}
      <div className="flex flex-col md:flex-row gap-3 flex-1 min-h-0">
        {/* live tasks — the hero */}
        <section className="flex-1 min-w-0 flex flex-col rounded-lg border border-border bg-card overflow-hidden min-h-0">
          <header className="px-4 py-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground border-b border-border shrink-0">
            Live tasks
          </header>
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {tasks.map((t) => (
              <div key={t.id} className="px-4 py-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor(t.status)} animate-pulse`} />
                  <span className="font-medium truncate">{t.title}</span>
                  <span className="ml-auto pl-3 text-xs font-mono tabular-nums text-muted-foreground shrink-0">
                    {t.assigned_to || 'unassigned'} · {t.created_at ? ago(t.created_at) : '—'}
                  </span>
                </div>
                <p className="mt-1 pl-[18px] text-sm text-muted-foreground truncate">{t.step}</p>
              </div>
            ))}
            {tasks.length === 0 && (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                All quiet — no agents running.
              </div>
            )}
          </div>
        </section>

        {/* activity stream */}
        <section className="w-full md:w-[340px] shrink-0 flex flex-col rounded-lg border border-border bg-card overflow-hidden min-h-0 max-h-[38dvh] md:max-h-none">
          <header className="px-4 py-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground border-b border-border shrink-0">
            Activity
          </header>
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {feed.map((f) => (
              <div key={f.id} className="px-4 py-2.5">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0">
                    {f.at ? ago(f.at) : '—'}
                  </span>
                  <span className="text-xs font-medium truncate">{f.taskTitle}</span>
                </div>
                <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground line-clamp-2">
                  {f.content}
                </p>
              </div>
            ))}
            {feed.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No activity yet.
              </div>
            )}
          </div>
        </section>
      </div>

      {/* steer bar */}
      <div className="flex gap-2 shrink-0">
        <select
          value={steerTask}
          onChange={(e) => setSteerTask(e.target.value)}
          className="h-10 max-w-[180px] rounded-lg border border-border bg-card px-2 text-sm text-foreground"
          aria-label="Task to steer"
        >
          <option value="">Steer…</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title.slice(0, 42)}
            </option>
          ))}
        </select>
        <input
          value={steerMsg}
          onChange={(e) => setSteerMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
          }}
          placeholder={steerTask ? 'Message the worker…' : 'Pick a task to steer it'}
          disabled={!steerTask}
          className="flex-1 h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={sending || !steerTask || !steerMsg.trim()}
          className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
