import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, Check, Hive, Hub, Repo, Snapshot } from '../types'

const PANE = 'hive'
const TITLE = 'hives'
const POLL_MS = 15_000
const TZ = 'Europe/Oslo'
const HIVE_IMAGE = 'hivecommons/hive'
// The podman Homebrew installs, for a session whose PATH lacks it.
const PODMAN = ['podman', '/opt/homebrew/bin/podman', '/usr/local/bin/podman']

const snapshot = atom({ plugin: 'hive', key: 'snapshot' } as const, null, { shape: 'hives-4' })

// Each hive container's dashboard token, read from its environment. Kept in
// memory only, never in $.state; a reload reads it again.
const tokens = new Map<string, string>()
// Alerts raised so far, so each one toasts once until it clears.
const alerting = new Set<string>()
// Each container's hive id from its last answer, so a hive that stops
// answering keeps its name.
const names = new Map<string, string>()

type Raw = Record<string, any>
type Container = {
  Names?: string[]
  Image?: string
  State?: string
  Ports?: { host_ip?: string; host_port?: number; container_port?: number }[] | null
  Labels?: Record<string, string>
}
type Found = { container: string; running: boolean; port: number | null }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

async function podman($: EngineInterface, args: string[]): Promise<string> {
  let last = 'podman not found'
  for (const bin of PODMAN) {
    try {
      const r = await $.process.run([bin, ...args], { timeoutMs: 10_000 })
      if (r.exitCode === 0) return r.stdout
      last = r.stderr.trim().split('\n').pop() || `podman exited ${r.exitCode}`
      if (!/not found|no such file/i.test(last)) break
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
  }
  throw new Error(last)
}

// Every hive container with the host port of the gateway in its compose
// project, and apart from them every hub, which publishes its own port.
export function discover(containers: Container[]): { hives: Found[]; hubs: Found[] } {
  const project = (c: Container) => c.Labels?.['com.docker.compose.project'] ?? ''
  const service = (c: Container) => c.Labels?.['com.docker.compose.service'] ?? ''
  const ours = containers.filter(c => str(c.Image).includes(HIVE_IMAGE))
  const found = (c: Container, port: number | null): Found => ({ container: c.Names?.[0] ?? '?', running: c.State === 'running', port })
  const byName = (a: Found, b: Found) => a.container.localeCompare(b.container)
  return {
    hubs: ours
      .filter(c => service(c) === 'hub')
      .map(c => found(c, c.Ports?.find(p => p.container_port === 3001)?.host_port ?? null))
      .sort(byName),
    hives: ours
      .filter(c => service(c) !== 'gateway' && service(c) !== 'hub')
      .map(c => {
        const gateway = containers.find(g => service(g) === 'gateway' && project(g) === project(c) && g.State === 'running')
        return found(c, gateway?.Ports?.find(p => p.container_port === 3001)?.host_port ?? null)
      })
      .sort(byName),
  }
}

async function token($: EngineInterface, container: string): Promise<string | null> {
  const known = tokens.get(container)
  if (known) return known
  const env = JSON.parse(await podman($, ['inspect', container, '--format', '{{json .Config.Env}}'])) as string[]
  const found = env.find(v => v.startsWith('HIVE_DASHBOARD_TOKEN='))?.slice('HIVE_DASHBOARD_TOKEN='.length)
  if (found) tokens.set(container, found)
  return found || null
}

function empty(container: string, port: number | null, error: string | null): Hive {
  return {
    container, port, error, hiveId: names.get(container) ?? container, health: 'unknown', checks: [], governor: '?', nextKickAt: null,
    acmm: null, acmmTarget: null, acmmAdvise: '', budgetPct: null, budgetOff: false, burnHourly: null, ghRemaining: null,
    weekUSD: null, agents: [], repos: [],
    hub: null, heartbeat: null, heartbeatDetail: '',
  }
}

export function parse(s: Raw, container: string, port: number | null): Hive {
  const b = s.budget ?? {}
  const kick = str(s.governor?.nextKickAt)
  return {
    ...empty(container, port, null),
    hiveId: str(s.hiveId) || container,
    health: str(s.deepHealth?.status) || 'unknown',
    checks: (s.deepHealth?.checks ?? [])
      .filter((c: Raw) => c.status !== 'pass')
      .map((c: Raw): Check => ({ name: str(c.name), status: str(c.status), detail: str(c.detail) })),
    governor: str(s.governor?.mode) || '?',
    nextKickAt: kick ? Date.parse(kick) : null,
    acmm: num(s.acmmLevel) ?? num(s.acmmAdvice?.CurrentLevel),
    acmmTarget: num(s.acmmAdvice?.TargetLevel),
    acmmAdvise: str(s.acmmAdvice?.Advise),
    budgetPct: num(b.BUDGET_PCT_USED),
    burnHourly: num(b.BURN_RATE_HOURLY),
    ghRemaining: num(s.ghRateLimits?.core?.remaining),
    weekUSD: num(s.fleetRun?.weekUSD),
    agents: (s.agents ?? []).map((a: Raw): Agent => ({
      name: str(a.displayName) || str(a.name),
      emoji: str(a.emoji) || '·',
      state: str(a.state),
      busy: str(a.busy),
      paused: a.paused === true,
      enabled: a.enabled !== false,
    })),
    repos: (s.repos ?? []).map((r: Raw): Repo => ({
      name: str(r.name),
      issues: num(r.issues) ?? 0,
      prs: num(r.prs) ?? 0,
      actionable: (num(r.workBreakdown?.issues?.actionable) ?? 0) + (num(r.workBreakdown?.prs?.actionable) ?? 0),
      held: (num(r.workBreakdown?.issues?.hold) ?? 0) + (num(r.workBreakdown?.prs?.hold) ?? 0),
    })),
  }
}

// Hosts a hive's hub_url can name for a hub running on this machine.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'host.containers.internal', 'host.docker.internal'])

// A hive's authenticated GET as JSON; null when it fails, so a hive without
// hub info is still a hive.
async function getJson($: EngineInterface, url: string, headers: Record<string, string> | undefined): Promise<Raw | null> {
  try {
    const r = await $.http.fetch(url, headers ? { headers } : undefined)
    return r.ok ? (JSON.parse(r.text) as Raw) : null
  } catch {
    return null
  }
}

// The local hub a hive reports to: its heartbeat check exists and hub_url
// points at a local alias on the hub's published port.
export function membership(config: Raw | null, deep: Raw | null, hubs: Found[]): Pick<Hive, 'hub' | 'heartbeat' | 'heartbeatDetail'> {
  const none = { hub: null, heartbeat: null, heartbeatDetail: '' }
  const beat = deep?.checks?.hub_heartbeat
  if (!beat || typeof beat !== 'object') return none
  const m = /^https?:\/\/([^/:?#]+)(?::(\d+))?/i.exec(str(config?.hub_url))
  if (!m || !LOCAL_HOSTS.has((m[1] ?? '').toLowerCase())) return none
  const hub = hubs.find(hb => hb.port !== null && String(hb.port) === m[2])
  if (!hub) return none
  return { hub: hub.container, heartbeat: beat.status === 'pass' ? 'pass' : 'warn', heartbeatDetail: str(beat.detail) }
}

async function pollHive($: EngineInterface, found: Found, hubs: Found[]): Promise<Hive> {
  const { container, running, port } = found
  if (!running) return empty(container, port, 'container stopped')
  if (port === null) return empty(container, null, 'no gateway port')
  try {
    const t = await token($, container)
    const headers = t ? { Authorization: `Bearer ${t}` } : undefined
    const base = `http://127.0.0.1:${port}`
    const [r, config, deep, ignore] = await Promise.all([
      $.http.fetch(`${base}/api/status`, headers ? { headers } : undefined),
      getJson($, `${base}/api/config`, headers),
      getJson($, `${base}/api/health/deep`, headers),
      getJson($, `${base}/api/budget-ignore`, headers),
    ])
    if (r.status === 401) tokens.delete(container) // re-read on the next poll
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const s = JSON.parse(r.text) as Raw
    // A hive still on its first pass answers with only its startup phase.
    if (s.status === 'initializing') {
      return { ...empty(container, port, null), health: 'starting', governor: str(s.startupPhaseLabel) || 'starting' }
    }
    // The budget bypass is global on the hive and not in /api/status.
    const hive = { ...parse(s, container, port), ...membership(config, deep, hubs), budgetOff: ignore?.ignored === true }
    names.set(container, hive.hiveId)
    return hive
  } catch (err) {
    return empty(container, port, err instanceof Error ? err.message : String(err))
  }
}

// The registry only says whether the hub is up: it answers anonymously with
// the public hives alone, so the hub's hives are counted from the hives that
// report to it instead.
async function pollHub($: EngineInterface, found: Found): Promise<Hub> {
  const { container, running, port } = found
  const hub = (error: string | null): Hub => ({ container, port, error })
  if (!running) return hub('container stopped')
  if (port === null) return hub('no published port')
  try {
    const r = await $.http.fetch(`http://127.0.0.1:${port}/api/registry`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return hub(null)
  } catch (err) {
    return hub(err instanceof Error ? err.message : String(err))
  }
}

const label = (hv: Hive) => hv.hiveId.replace(/^hive-/, '')

// Toasts each problem once and keeps the status line on the ones still open.
async function alert($: EngineInterface, snap: Snapshot): Promise<void> {
  const now = new Map<string, string>()
  if (snap.error) now.set('discover', `hives: ${snap.error}`)
  for (const hb of snap.hubs) if (hb.error) now.set(`${hb.container} down`, `${hb.container}: ${hb.error}`)
  for (const hv of snap.hives) {
    if (hv.error) now.set(`${hv.container} down`, `${label(hv)}: ${hv.error}`)
    for (const c of hv.checks.filter(c => c.status === 'fail')) now.set(`${hv.container} ${c.name}`, `${label(hv)} ${c.name} failing`)
    if (hv.budgetPct !== null && hv.budgetPct >= 100 && !hv.budgetOff) now.set(`${hv.container} budget`, `${label(hv)} budget exhausted`)
    if (hv.hub && hv.heartbeat === 'warn') now.set(`${hv.container} heartbeat`, `${label(hv)} heartbeat to ${hv.hub} not accepted`)
  }
  for (const [key, text] of now) if (!alerting.has(key)) void $.ui.toast(text)
  alerting.clear()
  for (const key of now.keys()) alerting.add(key)
  void $.ui.status(now.size > 0 ? `🐝 ${[...now.values()].join(' · ')}` : undefined)
}

async function poll($: EngineInterface): Promise<void> {
  const at = Date.now()
  let next: Snapshot
  try {
    const found = discover(JSON.parse(await podman($, ['ps', '-a', '--format', 'json'])) as Container[])
    const [hives, hubs] = await Promise.all([
      Promise.all(found.hives.map(f => pollHive($, f, found.hubs))),
      Promise.all(found.hubs.map(f => pollHub($, f))),
    ])
    next = { at, error: null, hives, hubs }
  } catch (err) {
    const prev = await read($, snapshot)
    next = { at, error: err instanceof Error ? err.message : String(err), hives: prev?.hives ?? [], hubs: prev?.hubs ?? [] }
  }
  await alert($, next)
  await update($, snapshot, () => next)
}

function clock(ms: number | null): string {
  return ms === null ? '?' : new Date(ms).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
}

function compact(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n))
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
const level = (pct: number) => (pct >= 90 ? 'red' : pct >= 75 ? 'yellow' : 'green')
const dot = (hv: Hive) =>
  hv.error ? "red" : hv.health === "ok" ? "green" : hv.health === "starting" || hv.health === "unknown" ? undefined : "yellow"

type Ui = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Text'>

// The hub's line: ◆ hub · 2 hives · :3021, the port in the pane only. The
// count is the hives listed under it.
function hubLine({ Text }: Ui, hb: Hub, children: number, long: boolean) {
  const port = long && hb.port ? <Text dimColor> · :{hb.port}</Text> : null
  return (
    <Text wrap="truncate-end">
      <Text color={hb.error ? 'red' : 'green'}>◆</Text> <Text bold>hub</Text>
      {hb.error ? <Text color="red"> {hb.error}</Text> : <Text dimColor> · </Text>}
      {hb.error ? null : children === 0 ? 'no hives' : `${children} ${children === 1 ? 'hive' : 'hives'}`}
      {port}
    </Text>
  )
}

// One line per hive: ● name health · governor · ACMM level · agents up/total · issues/PRs · budget.
function line({ Text }: Ui, hv: Hive, long: boolean, nested: boolean) {
  const pad = nested ? '  ' : ''
  if (hv.error) {
    return (
      <Text wrap="truncate-end">
        {pad}<Text color="red">●</Text> <Text bold>{label(hv)}</Text> <Text color="red">{hv.error}</Text>
        {long && hv.port ? <Text dimColor> :{hv.port}</Text> : null}
      </Text>
    )
  }
  const up = hv.agents.filter(a => a.state === 'running').length
  const busy = hv.agents.filter(a => a.busy === 'busy').length
  const issues = hv.repos.reduce((n, r) => n + r.issues, 0)
  const prs = hv.repos.reduce((n, r) => n + r.prs, 0)
  return (
    <Text wrap="truncate-end">
      {pad}<Text color={dot(hv)}>●</Text> <Text bold>{label(hv)}</Text>
      {hv.health !== 'ok' ? <Text color={dot(hv)}> {hv.health}</Text> : null}
      <Text dimColor> · </Text>{hv.governor}
      {long && hv.nextKickAt ? <Text dimColor> {clock(hv.nextKickAt)}</Text> : null}
      {hv.acmm !== null ? (
        <Text>
          <Text dimColor> · </Text>L{hv.acmm}
          {long && hv.acmmTarget !== null && hv.acmmTarget !== hv.acmm && hv.acmmAdvise ? (
            <Text dimColor> → L{hv.acmmTarget} {hv.acmmAdvise}</Text>
          ) : null}
        </Text>
      ) : null}
      <Text dimColor> · </Text>{up}/{hv.agents.length}{busy ? <Text color="cyan"> {busy} busy</Text> : null}
      <Text dimColor> · </Text>{issues}i {prs}p
      {hv.budgetPct !== null ? (
        <Text>
          <Text dimColor> · </Text>
          {hv.budgetOff ? (
            <Text dimColor>{Math.round(hv.budgetPct)}% off</Text>
          ) : (
            <Text color={level(hv.budgetPct)}>{Math.round(hv.budgetPct)}%</Text>
          )}
          {long && hv.burnHourly ? <Text dimColor> {compact(hv.burnHourly)}/h</Text> : null}
        </Text>
      ) : hv.budgetOff ? (
        <Text dimColor> · budget off</Text>
      ) : null}
      {long && hv.weekUSD ? <Text dimColor> · ${hv.weekUSD.toFixed(2)}/wk</Text> : null}
      {long && hv.port ? <Text dimColor> · :{hv.port}</Text> : null}
      {nested && hv.heartbeat === 'warn' ? (
        <Text color="yellow" dimColor> · hb⚠{long && hv.heartbeatDetail ? ` ${truncate(hv.heartbeatDetail, 40)}` : ''}</Text>
      ) : null}
    </Text>
  )
}

// Under the hive's line: the running agents, each repo, and checks not passing.
function detail({ Text }: Ui, hv: Hive, nested: boolean) {
  if (hv.error || hv.health === 'starting') return null
  const on = hv.agents.filter(a => a.state === 'running' || a.paused)
  const off = hv.agents.length - on.length
  return (
    <Text wrap="truncate-end" dimColor>
      {nested ? '    ' : '  '}
      {on.map(a => (
        <Text>
          {a.emoji}<Text color={a.paused ? 'yellow' : a.busy === 'busy' ? 'cyan' : undefined}>{a.name}</Text>{' '}
        </Text>
      ))}
      {off ? `+${off} off` : ''}
      {hv.repos.map(r => (
        <Text>
          {' │ '}{r.name} {r.issues}i {r.prs}p
          {r.actionable ? <Text color="cyan"> {r.actionable}↑</Text> : null}
          {r.held ? <Text color="yellow"> {r.held}⏸</Text> : null}
        </Text>
      ))}
      {hv.checks.map(c => <Text color={c.status === 'fail' ? 'red' : 'yellow'}>{' │ '}{c.name}</Text>)}
    </Text>
  )
}

// Each hub with the hives that report to it indented under it, then the
// hives with no local hub at the top level.
function tree(ui: Ui, snap: Snapshot, long: boolean) {
  const { Box } = ui
  const entry = (hv: Hive, nested: boolean) => (
    <Box flexDirection="column">
      {line(ui, hv, long, nested)}
      {long ? detail(ui, hv, nested) : null}
    </Box>
  )
  const kids = (hb: Hub) => snap.hives.filter(hv => hv.hub === hb.container)
  const loose = snap.hives.filter(hv => !snap.hubs.some(hb => hb.container === hv.hub))
  return [
    ...snap.hubs.map(hb => (
      <Box flexDirection="column">
        {hubLine(ui, hb, kids(hb).length, long)}
        {kids(hb).map(hv => entry(hv, true))}
      </Box>
    )),
    ...loose.map(hv => entry(hv, false)),
  ]
}

function pane(ui: Ui, snap: Snapshot) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      {snap.hives.length === 0 && snap.hubs.length === 0 ? <Text dimColor>No hive containers in podman.</Text> : null}
      {tree(ui, snap, true)}
      <Text dimColor wrap="truncate-end">
        updated {clock(snap.at)} · every {POLL_MS / 1000}s · i issues, p PRs, ↑ ready, ⏸ held
        {snap.error ? ` · podman: ${snap.error}` : ''}
      </Text>
    </Box>
  )
}

async function openWhileEmpty($: EngineInterface): Promise<void> {
  if ((await $.session.turns()) === 0) await $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'hive', description: 'Show every local hive: health, governor, agents, repos and budget' })
    void poll($)
    $.clock.every(POLL_MS, () => poll($))
    void openWhileEmpty($)
    return next(e)
  })

  // A /clear ends the session without a new session.start: the next one is empty.
  on('session.end', { reason: 'clear' }, async ($, e, next) => {
    const result = await next(e)
    void $.ui.open({ id: PANE, title: TITLE })
    return result
  })

  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    const result = await next(e)
    void $.ui.close({ id: PANE })
    return result
  })

  on('command.run', { command: 'hive' }, async $ => {
    await poll($)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'hives pane opened; it closes at your next prompt.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const snap = await read($, snapshot)
    if (!snap) return <ui.Text dimColor>Looking for hives in podman...</ui.Text>
    return pane(ui, snap)
  })

  // The engine's spinner line, with one short line per hive under it, the
  // hives of a hub indented under its line.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (!snap || snap.hives.length + snap.hubs.length === 0) return next(e)
    const ui = $.ui.resolve(e)
    return (
      <ui.Box flexDirection="column">
        {await next(e)}
        {tree(ui, snap, false)}
      </ui.Box>
    )
  })
}
