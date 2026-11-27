// One poll of every hive and hub found in podman. Numbers are null when the hive
// did not report them.
export type Agent = { name: string; emoji: string; state: string; busy: string; paused: boolean; enabled: boolean }
export type Check = { name: string; status: string; detail: string }
export type Repo = { name: string; issues: number; prs: number; actionable: number; held: number }
export type Hive = {
  container: string // the hive container, which identifies the hive across polls
  port: number | null // the gateway's published port on the host
  error: string | null // not running, no gateway, or did not answer
  hiveId: string
  health: string // ok, warning, degraded, ...
  checks: Check[] // the ones not passing
  governor: string
  nextKickAt: number | null
  acmm: number | null // the hive's ACMM level; null when it does not report one
  acmmTarget: number | null // the level its advice aims for
  acmmAdvise: string // the advice itself, such as stay; '' without one
  budgetPct: number | null
  budgetOff: boolean // budgets bypassed on the hive, from /api/budget-ignore
  burnHourly: number | null
  ghRemaining: number | null
  weekUSD: number | null
  agents: Agent[]
  repos: Repo[]
  hub: string | null // the local hub container this hive reports to
  heartbeat: 'pass' | 'warn' | null // its last beat to that hub; null without one
  heartbeatDetail: string // why the beat was not accepted, when it says
}
export type Hub = {
  container: string
  port: number | null // the port the hub publishes on the host
  error: string | null // not running, no port, or did not answer
}
export type Snapshot = { at: number; error: string | null; hives: Hive[]; hubs: Hub[] }

declare module 'claude-code' {
  interface PluginState {
    hive: { snapshot: Shaped<Snapshot | null> }
  }
}
