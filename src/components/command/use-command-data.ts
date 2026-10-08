'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

/**
 * Command-view data: the operator's live state, polled every 10s.
 * Data contract (unchanged): /api/tasks, /api/tasks/<id>/comments,
 * /api/agents, POST /api/tasks/<id>/comments, POST /api/quality-review.
 */

export interface LiveTask {
  id: number
  title: string
  status: string
  assigned_to?: string
  created_at: number
  updated_at: number
  step: string
  stepAt: number
}

export interface Agent {
  id: number
  name: string
  status: string
  role?: string
}

export interface FeedItem {
  id: string
  taskTitle: string
  author: string
  content: string
  at: number
}

const LIVE_STATUSES = new Set(['in_progress', 'review', 'quality_review'])
export const REVIEW_STATUSES = new Set(['review', 'quality_review'])

/** normalize epoch seconds vs millis */
export function toSec(ts: number): number {
  if (!ts) return 0
  return ts > 1e12 ? Math.floor(ts / 1000) : ts
}

export function ago(ts: number): string {
  const t = toSec(ts)
  if (!t) return '—'
  const s = Math.max(0, Math.floor(Date.now() / 1000) - t)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function useCommandData() {
  const [tasks, setTasks] = useState<LiveTask[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [clock, setClock] = useState('')
  const [steerTask, setSteerTask] = useState<string>('')
  const [steerMsg, setSteerMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [approving, setApproving] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [taskData, agentData] = await Promise.all([
        apiFetch<{ tasks?: any[] }>('/api/tasks?limit=100'),
        apiFetch<{ agents?: any[] }>('/api/agents').catch(() => ({ agents: [] as any[] })),
      ])
      const live = (taskData.tasks || []).filter((t) => LIVE_STATUSES.has(t.status))
      setAgents(
        (agentData.agents || []).map((a: any) => ({
          id: a.id,
          name: String(a.name || `agent-${a.id}`),
          status: String(a.status || 'offline'),
          role: a.role ? String(a.role) : undefined,
        })),
      )

      const enriched = await Promise.all(
        live.map(async (t) => {
          let step = 'working…'
          let stepAt = toSec(t.updated_at || t.created_at)
          let comments: any[] = []
          try {
            const c = await apiFetch<{ comments?: any[] }>(`/api/tasks/${t.id}/comments`)
            comments = c.comments || []
            const last = comments[comments.length - 1]
            if (last) {
              step = String(last.content || 'working…').slice(0, 160)
              stepAt = toSec(last.created_at) || stepAt
            }
          } catch {
            /* comments are best-effort */
          }
          return {
            task: {
              id: t.id,
              title: String(t.title || 'Untitled'),
              status: t.status,
              assigned_to: t.assigned_to ? String(t.assigned_to) : undefined,
              created_at: toSec(t.created_at),
              updated_at: toSec(t.updated_at),
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
            at: toSec(c.created_at),
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

  const approve = useCallback(
    async (taskId: number, reviewer: string) => {
      if (approving !== null) return
      setApproving(taskId)
      try {
        await apiFetch('/api/quality-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId,
            reviewer,
            status: 'approved',
            notes: 'approved from command view',
          }),
        })
        load()
      } catch {
        /* poll recovers */
      } finally {
        setApproving(null)
      }
    },
    [approving, load],
  )

  const online = agents.filter((a) => a.status !== 'offline').length
  const needsYou = tasks.filter((t) => REVIEW_STATUSES.has(t.status)).length

  return {
    tasks,
    agents,
    feed,
    clock,
    online,
    needsYou,
    steerTask,
    setSteerTask,
    steerMsg,
    setSteerMsg,
    sending,
    send,
    approving,
    approve,
  }
}

export type CommandData = ReturnType<typeof useCommandData>
