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
  budgetPct: number | null
  burnHourly: number | null
  ghRemaining: number | null
  weekUSD: number | null
  agents: Agent[]
  repos: Repo[]
}
export type Hub = {
  container: string
  port: number | null // the port the hub publishes on the host
  error: string | null // not running, no port, or did not answer
  hives: number | null // hives in its registry; null when it listed none
}
export type Snapshot = { at: number; error: string | null; hives: Hive[]; hubs: Hub[] }

declare module 'claude-code' {
  interface PluginState {
    hive: { snapshot: Shaped<Snapshot | null> }
  }
}
