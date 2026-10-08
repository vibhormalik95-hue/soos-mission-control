'use client'

import { CommandView } from '@/components/command/command-view'

/**
 * Dashboard — the operator's single screen (command view).
 *
 * Rendered chromeless from the overview route (see page.tsx): the command
 * view fills the whole viewport. Kept as the fallback for unknown/plugin
 * panels too.
 */
export function Dashboard() {
  return <CommandView />
}
