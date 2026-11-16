/**
 * dsh-bang-shell — a tiny DeepSeek Harness plugin.
 *
 * Type "!command" in a session composer. The command runs on the host and only
 * its output is handed to the model: the command line itself never enters the
 * model context, so it can carry anything you would not paste into a chat.
 *
 * No client code and no model-facing tool: the plugin rewrites one user message
 * during the agent pre-step. That is why it behaves the same in the Web UI and
 * in a mobile client — the command runs on the host either way, and the model
 * answers with the output.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import process from 'node:process'

export const name = 'bang-shell'

const execFileAsync = promisify(execFile)

const DEFAULTS = Object.freeze({
  timeoutMs: 120_000,
  maxOutputChars: 20_000,
  shell: undefined,
  loginShell: true,
  prefix: '[local shell output]',
  includeCommand: false,
})

function pick(config) {
  const out = { ...DEFAULTS }
  for (const [key, value] of Object.entries(config ?? {})) {
    if (value !== undefined && value !== null) out[key] = value
  }
  return out
}

function bangOf(message) {
  if (message?.source?.kind !== 'user') return undefined
  const blocks = message.content
  if (!Array.isArray(blocks) || blocks.length === 0) return undefined
  if (!blocks.every(block => block?.type === 'text')) return undefined
  const text = blocks.map(block => block.text ?? '').join('').trim()
  if (!text.startsWith('!')) return undefined
  const command = text.slice(1).trim()
  return command.length > 0 ? command : undefined
}

function invocationOf(command, options) {
  if (process.platform === 'win32') {
    const file = options.shell || process.env.ComSpec || 'cmd.exe'
    return { file, args: ['/d', '/s', '/c', '"' + command + '"'], windowsVerbatimArguments: true }
  }
  const file = options.shell || process.env.SHELL || '/bin/sh'
  return { file, args: [options.loginShell ? '-lc' : '-c', command] }
}

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g

function clip(text, options) {
  let value = text.replace(ANSI, '').replace(/\r\n?/g, '\n')
  const max = options.maxOutputChars
  if (max > 0 && value.length > max) value = value.slice(-max)
  return value
}

async function runShell(command, cwd, options, signal) {
  const started = Date.now()
  const { file, args, windowsVerbatimArguments } = invocationOf(command, options)
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd,
      env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
      timeout: options.timeoutMs > 0 ? options.timeoutMs : undefined,
      maxBuffer: Math.max(64 * 1024, options.maxOutputChars * 8),
      windowsHide: true,
      windowsVerbatimArguments,
      signal,
    })
    return { text: clip(String(stdout) + String(stderr), options), status: 'exit 0', ok: true, ms: Date.now() - started }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      return { text: '', status: 'cancelled', ok: false, ms: Date.now() - started }
    }
    const text = clip(String(error?.stdout ?? '') + String(error?.stderr ?? ''), options)
    if (error?.killed) {
      return { text, status: 'timed out after ' + options.timeoutMs / 1000 + 's', ok: false, ms: Date.now() - started }
    }
    if (error?.code === 'ENOENT' || error?.code === 'EACCES') {
      return { text: '', status: 'failed to start: ' + String(error.message), ok: false, ms: Date.now() - started }
    }
    const code = typeof error?.code === 'number' ? error.code : 1
    return { text, status: 'exit ' + code, ok: code === 0, ms: Date.now() - started }
  }
}

function fence(text) {
  let ticks = String.fromCharCode(96).repeat(3)
  while (text.includes(ticks)) ticks += String.fromCharCode(96)
  return ticks + '\n' + text + '\n' + ticks
}

function render(command, result, options) {
  const head = options.includeCommand ? options.prefix + ' · !' + command : options.prefix
  const body = result.text.replace(/\n+$/, '')
  const shown = body.length > 0 ? body : '(no output)'
  return head + ' · ' + result.status + ' · ' + (result.ms / 1000).toFixed(2) + 's\n' + fence(shown)
}

export function apply(ctx, config = {}) {
  const options = pick(config)

  async function cwdFor(signal) {
    try {
      const wd = ctx.get('workingDirectory')
      if (wd) return String(await wd.ensure(undefined, signal))
    } catch { /* fall back to the host directory */ }
    return process.cwd()
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter' || payload?.signal?.aborted) return decision

    let changed = false
    const messages = []
    for (const message of decision.messages) {
      const command = bangOf(message)
      if (command === undefined) {
        messages.push(message)
        continue
      }
      const cwd = await cwdFor(payload.signal)
      const result = await runShell(command, cwd, options, payload.signal)
      messages.push({ ...message, content: [{ type: 'text', text: render(command, result, options) }] })
      changed = true
    }
    return changed ? { ...decision, messages } : decision
  })
}
