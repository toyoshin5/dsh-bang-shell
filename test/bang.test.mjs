import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../host/index.js'

function harness(config) {
  let handler
  const ctx = {
    on(event, fn) { if (event === 'agent/pre-step') handler = fn },
    effect() {},
    get() { return undefined },
  }
  apply(ctx, config)
  assert.equal(typeof handler, 'function')
  return handler
}

const user = text => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const enter = messages => async () => ({ kind: 'enter', messages })
const payload = () => ({ step: 1, agent: {}, signal: new AbortController().signal })

test('replaces a bang message with its output', async () => {
  const handler = harness({})
  const decision = await handler(payload(), enter([user('!printf hello'), user('plain text')]))
  assert.equal(decision.messages.length, 2)
  assert.match(decision.messages[0].content[0].text, /hello/)
  assert.doesNotMatch(decision.messages[0].content[0].text, /printf hello/)
  assert.equal(decision.messages[1].content[0].text, 'plain text')
  assert.equal(decision.messages[0].source.kind, 'user')
})

test('leaves a step without bang messages untouched', async () => {
  const handler = harness({})
  const decision = await handler(payload(), enter([user('hello')]))
  assert.equal(decision.messages.length, 1)
  assert.equal(decision.messages[0].content[0].text, 'hello')
})

test('keeps output of a failing command', async () => {
  const handler = harness({})
  const decision = await handler(payload(), enter([user('!echo oops >&2; exit 3')]))
  const text = decision.messages[0].content[0].text
  assert.match(text, /oops/)
  assert.match(text, /exit 3/)
})

test('marks empty output', async () => {
  const handler = harness({})
  const decision = await handler(payload(), enter([user('!true')]))
  assert.match(decision.messages[0].content[0].text, /\(no output\)/)
})

test('ignores non-user sources and bare "!"', async () => {
  const handler = harness({})
  const tool = { role: 'tool', source: { kind: 'tool' }, content: [{ type: 'text', text: '!not mine' }] }
  const decision = await handler(payload(), enter([tool, user('!')]))
  assert.equal(decision.messages[0].content[0].text, '!not mine')
  assert.equal(decision.messages[1].content[0].text, '!')
})

test('can include the command line when configured', async () => {
  const handler = harness({ includeCommand: true })
  const decision = await handler(payload(), enter([user('!printf hi')]))
  assert.match(decision.messages[0].content[0].text, /!printf hi/)
})
