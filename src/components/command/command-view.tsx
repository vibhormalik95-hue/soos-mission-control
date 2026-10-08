'use client'

import { useEffect, useRef, useState } from 'react'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import {
  ago,
  REVIEW_STATUSES,
  useCommandData,
  type CommandData,
} from './use-command-data'

/**
 * Command view — the operator's single screen.
 *
 * One page, no body scroll, fixed viewport. Status strip up top, live tasks
 * as the hero, activity stream, steer bar pinned at the bottom. Restrained
 * Obsidian-like density: hairline dividers, dimmed secondary text, color
 * reserved for state. Other panels stay one tap away via the "more" menu.
 */

const MORE_ITEMS: { id: string; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'agents', label: 'Agents' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'chat', label: 'Chat' },
  { id: 'activity', label: 'Activity' },
  { id: 'logs', label: 'Logs' },
  { id: 'exec-approvals', label: 'Approvals' },
  { id: 'cron', label: 'Cron' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'settings', label: 'Settings' },
  { id: 'users', label: 'Users' },
]

function taskDot(status: string): string {
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

function MoreMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigateToPanel = useNavigateToPanel()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open ])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="More panels"
        aria-expanded={open}
        className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
      >
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-44 rounded-md border border-border bg-popover py-1 shadow-lg">
          {MORE_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setOpen(false)
                navigateToPanel(item.id)
              }}
              className="w-full text-left px-3 py-1.5 text-[13px] text-foreground hover:bg-secondary"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusStrip({ data }: { data: CommandData }) {
  return (
    <header className="h-10 shrink-0 flex items-center gap-3 px-3 border-b border-border">
      <span className="flex items-center gap-1.5 text-[13px] font-medium">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
        LIVE
      </span>
      <span className="font-mono tabular-nums text-xs">
        {data.tasks.length} running
      </span>
      <span className="font-mono tabular-nums text-xs text-muted-foreground">
        {data.online}/{data.agents.length} online
      </span>
      {data.needsYou > 0 && (
        <span className="text-xs font-medium text-amber-400">
          {data.needsYou} needs you
        </span>
      )}
      <span className="ml-auto" />
      <span className="font-mono tabular-nums text-xs text-muted-foreground">
        {data.clock}
      </span>
      <MoreMenu />
    </header>
  )
}

function AgentsRow({ data }: { data: CommandData }) {
  if (data.agents.length === 0) return null
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex items-center gap-1.5 overflow-x-auto px-3 h-9">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground shrink-0 mr-1">
          Agents
        </span>
        {data.agents.map((a) => {
          const current = data.tasks.find((t) => t.assigned_to === a.name)
          const online = a.status !== 'offline'
          return (
            <span
              key={a.id}
              title={online ? `${a.name} · ${a.status}${current ? ` · ${current.title}` : ''}` : `${a.name} · offline`}
              className="flex items-center gap-1.5 shrink-0 h-6 px-2 rounded border border-border text-xs"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                aria-hidden="true"
              />
              <span className={online ? 'text-foreground' : 'text-muted-foreground'}>
                {a.name}
              </span>
              {current && (
                <span className="text-muted-foreground truncate max-w-[140px]">
                  · {current.title}
                </span>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function TaskRow({
  task,
  data,
  reviewer,
}: {
  task: CommandData['tasks'][number]
  data: CommandData
  reviewer: string
}) {
  const needsReview = REVIEW_STATUSES.has(task.status)
  const approving = data.approving === task.id
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${taskDot(task.status)} ${task.status === 'in_progress' ? 'animate-pulse' : ''}`}
          aria-hidden="true"
        />
        <span className="text-[13px] font-medium truncate">{task.title}</span>
        {needsReview && (
          <button
            onClick={() => data.approve(task.id, reviewer)}
            disabled={approving}
            className="shrink-0 h-6 px-2 rounded border border-border text-[11px] font-medium text-sky-400 hover:bg-secondary disabled:opacity-50"
          >
            {approving ? '…' : 'Approve'}
          </button>
        )}
        <span className="ml-auto pl-2 text-[11px] font-mono tabular-nums text-muted-foreground shrink-0">
          {task.assigned_to || 'unassigned'} · {task.created_at ? ago(task.created_at) : '—'}
        </span>
      </div>
      <p className="mt-0.5 pl-4 text-xs text-muted-foreground truncate">{task.step}</p>
    </div>
  )
}

export function CommandView() {
  const data = useCommandData()
  const { currentUser } = useMissionControl()
  const reviewer = currentUser?.display_name || currentUser?.username || 'operator'

  return (
    <div className="flex flex-col h-full min-h-0">
      <StatusStrip data={data} />
      <AgentsRow data={data} />

      {/* main region */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* live tasks — the hero */}
        <section aria-label="Live tasks" className="flex-1 min-h-0 flex flex-col md:border-r border-border">
          <h2 className="px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground border-b border-border shrink-0">
            Running{data.tasks.length > 0 ? ` · ${data.tasks.length}` : ''}
          </h2>
          <div className="flex-1 overflow-y-auto divide-y divide-border/60">
            {data.tasks.map((t) => (
              <TaskRow key={t.id} task={t} data={data} reviewer={reviewer} />
            ))}
            {data.tasks.length === 0 && (
              <div className="h-full flex items-center justify-center text-[13px] text-muted-foreground px-6 text-center">
                All quiet — no agents running.
              </div>
            )}
          </div>
        </section>

        {/* activity stream */}
        <section
          aria-label="Activity"
          className="shrink-0 flex flex-col min-h-0 border-t md:border-t-0 border-border h-[32%] md:h-auto md:w-[340px]"
        >
          <h2 className="px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground border-b border-border shrink-0">
            Activity
          </h2>
          <div className="flex-1 overflow-y-auto divide-y divide-border/60">
            {data.feed.map((f) => (
              <div key={f.id} className="px-3 py-2">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
                    {f.at ? ago(f.at) : '—'}
                  </span>
                  <span className="text-[11px] font-medium truncate">{f.taskTitle}</span>
                </div>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground line-clamp-2">
                  {f.content}
                </p>
              </div>
            ))}
            {data.feed.length === 0 && (
              <div className="p-6 text-center text-[13px] text-muted-foreground">
                No activity yet.
              </div>
            )}
          </div>
        </section>
      </div>

      {/* steer bar — pinned */}
      <div className="shrink-0 border-t border-border px-3 py-2 flex gap-2">
        <select
          value={data.steerTask}
          onChange={(e) => data.setSteerTask(e.target.value)}
          className="h-9 max-w-[150px] rounded border border-border bg-background px-2 text-[13px] text-foreground"
          aria-label="Task to steer"
        >
          <option value="">Steer…</option>
          {data.tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title.slice(0, 42)}
            </option>
          ))}
        </select>
        <input
          value={data.steerMsg}
          onChange={(e) => data.setSteerMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') data.send()
          }}
          placeholder={data.steerTask ? 'Message the worker…' : 'Pick a task to steer it'}
          disabled={!data.steerTask}
          className="flex-1 h-9 rounded border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground disabled:opacity-50 min-w-0"
        />
        <button
          onClick={data.send}
          disabled={data.sending || !data.steerTask || !data.steerMsg.trim()}
          className="h-9 px-4 rounded bg-primary text-primary-foreground text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {data.sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
