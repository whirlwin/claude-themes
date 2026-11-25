import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

const SPINNER = { word: 'Baking', message: null, suffix: '…', mode: 'responding' as const }
const label = (project: string, service: string) => ({
  'com.docker.compose.project': project,
  'com.docker.compose.service': service,
})
// Trimmed from real `podman ps -a --format json`: two hives with gateways, one stopped hive, a hub.
const PS = [
  { Names: ['hive'], Image: 'ghcr.io/hivecommons/hive:stable', State: 'running', Ports: null, Labels: label('src', 'hive') },
  { Names: ['hive-gateway'], Image: 'docker.io/library/nginx', State: 'running', Labels: label('src', 'gateway'),
    Ports: [{ host_ip: '127.0.0.1', container_port: 3001, host_port: 3001 }] },
  { Names: ['hive-acme'], Image: 'ghcr.io/hivecommons/hive:stable', State: 'running', Ports: null, Labels: label('hive-acme', 'hive') },
  { Names: ['hive-acme-gateway'], Image: 'docker.io/library/nginx', State: 'running', Labels: label('hive-acme', 'gateway'),
    Ports: [{ host_ip: '127.0.0.1', container_port: 3001, host_port: 3011 }] },
  { Names: ['hive-old'], Image: 'ghcr.io/hivecommons/hive:stable', State: 'exited', Ports: null, Labels: label('old', 'hive') },
  { Names: ['hive-hub'], Image: 'ghcr.io/hivecommons/hive:stable', State: 'running', Labels: label('hive-hub', 'hub'),
    Ports: [{ host_ip: '127.0.0.1', container_port: 3001, host_port: 3021 }] },
  { Names: ['kind-control-plane'], Image: 'kindest/node', State: 'running', Ports: null, Labels: {} },
]
const status = (hiveId: string, health: string, repo: string, issues: number, prs: number) => ({
  hiveId,
  governor: { mode: hiveId.endsWith('main') ? 'surge' : 'idle', nextKickAt: '2026-11-25T12:46:07Z' },
  deepHealth: { status: health, checks: health === 'ok' ? [] : [{ name: 'tokens', status: 'warn', detail: 'zero consumed' }] },
  budget: { BUDGET_PCT_USED: 65.2, BURN_RATE_HOURLY: 38852 },
  agents: [
    { name: 'scanner', emoji: '🔍', state: 'running', busy: 'idle', enabled: true },
    { name: 'guide', emoji: '🧭', state: 'stopped', busy: 'idle', enabled: false },
  ],
  repos: [{ name: repo, issues, prs, workBreakdown: { issues: { actionable: 0, hold: 0 }, prs: { actionable: 2, hold: 1 } } }],
})
const STATUS: Record<string, unknown> = {
  3001: status('hive-acme-web', 'ok', 'web', 1, 0),
  3011: status('hive-acme-main', 'warning', 'api', 3, 35),
}

function engine(on: On, answers: Record<string, number> = {}) {
  const seen = { panes: [] as string[], toasts: [] as string[], auth: new Map<string, string | undefined>() }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.turns', () => ({ value: 0 }))
  on('process.run', (_, e) => {
    const [, sub, name] = e.argv
    const out = sub === 'ps' ? PS : [`HIVE_DASHBOARD_TOKEN=tok-${name}`, 'PATH=/bin']
    return { value: { exitCode: 0, stdout: JSON.stringify(out), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', (_, e) => {
    const port = /:(\d+)\//.exec(e.url)?.[1] ?? ''
    seen.auth.set(port, (e.init?.headers as Record<string, string> | undefined)?.Authorization)
    const code = answers[port] ?? 200
    const body = e.url.endsWith('/api/registry') ? { hives: [{ id: 'hive-acme-web' }, { id: 'hive-acme-main' }], updatedAt: 'now' } : STATUS[port]
    return { value: { status: code, ok: code < 300, headers: {}, text: JSON.stringify(body ?? {}) } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => { seen.toasts.push((e as { text: string }).text); return { value: undefined } })
  on('ui.open', (_, e) => { seen.panes.push(`open ${e.id}`); return { value: { isPlaced: true } } })
  on('ui.close', (_, e) => { seen.panes.push(`close ${e.id}`); return { value: undefined } })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const props = e.props as { word: string; suffix: string }
    return h(Text, {}, `${props.word}${props.suffix}`) as RenderElement
  })
  return seen
}

function shown(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(shown).join('')
  if (typeof node !== 'object' || node === null || !('children' in node)) return ''
  return shown((node as { children: unknown }).children)
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

test('finds every hive in podman and asks each with its own token', async ($, on) => {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const seen = engine(on)
  await start($)
  await clock.advance(100)
  expect(seen.auth.get('3001')).toBe('Bearer tok-hive')
  expect(seen.auth.get('3011')).toBe('Bearer tok-hive-acme')
  expect(seen.panes).toEqual(['open hive'])
  const ui = await $.ui.mount({ plugin: 'hive', surface: 'terminal', component: 'Pane', requestId: 'hive', props: {} as never })
  const text = shown(await ui.drawn())
  expect(text).toMatch(/acme-main warning · surge/)
  expect(text).toMatch(/acme-web · idle/)
  expect(text).toContain('api 3i 35p 2↑ 1⏸')
  expect(text).toContain('🔍scanner')
  expect(text).toContain('+1 off')
  expect(text).toMatch(/old container stopped/)
  expect(text).not.toContain('kind')
  expect(text).not.toContain('no gateway port')
  expect(text).toContain('◆ hub')
  expect(seen.auth.has('3021')).toBe(true)
  expect(seen.auth.get('3021')).toBeUndefined()
  expect(text).not.toContain('tok-')
})

test('the spinner keeps the engine line and adds one line per hive', async ($, on) => {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  engine(on)
  await start($)
  await clock.advance(100)
  const ui = await $.ui.mount({ plugin: 'hive', surface: 'terminal', component: 'Spinner', requestId: 'main', props: SPINNER })
  const text = shown(await ui.drawn())
  expect(text).toContain('Baking…')
  expect(text).toContain('acme-main warning · surge · 1/2 · 3i 35p · 65%')
  expect(text).toContain('acme-web · idle · 1/2 · 1i 0p · 65%')
  expect(text).toContain('◆ hub · 2 hives')
  expect(text).not.toContain(':3021')
  expect(text.indexOf('◆ hub')).toBeLessThan(text.indexOf('acme-main'))
})

test('the pane lists the hub first with its port and not as a hive', async ($, on) => {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  engine(on)
  await start($)
  await clock.advance(100)
  const ui = await $.ui.mount({ plugin: 'hive', surface: 'terminal', component: 'Pane', requestId: 'hive', props: {} as never })
  const text = shown(await ui.drawn())
  expect(text).toContain('◆ hub · 2 hives · :3021')
  expect(text.indexOf('◆ hub')).toBeLessThan(text.indexOf('acme-main'))
  expect(text.match(/hub/g)).toHaveLength(1)
})

test('a hub that stops answering toasts once', async ($, on) => {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const answers: Record<string, number> = {}
  const seen = engine(on, answers)
  await start($)
  await clock.advance(100)
  answers[3021] = 502
  await clock.advance(15_000)
  await clock.advance(15_000)
  expect(seen.toasts.filter(t => t.includes('hive-hub'))).toEqual(['hive-hub: HTTP 502'])
})

test('a hive that stops answering toasts once', async ($, on) => {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const answers: Record<string, number> = {}
  const seen = engine(on, answers)
  await start($)
  await clock.advance(100)
  answers[3011] = 502
  await clock.advance(15_000)
  await clock.advance(15_000)
  expect(seen.toasts.filter(t => t.includes('HTTP 502'))).toEqual(['acme-main: HTTP 502'])
})
