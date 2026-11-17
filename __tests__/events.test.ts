import { describe, expect, it } from 'vitest'
import { isSupportedEvent, unsupportedEventMessage } from '../src/events.js'

describe('isSupportedEvent', () => {
  it('accepts pull_request and pull_request_review', () => {
    expect(isSupportedEvent('pull_request')).toBe(true)
    expect(isSupportedEvent('pull_request_review')).toBe(true)
  })

  it('rejects other events', () => {
    expect(isSupportedEvent('push')).toBe(false)
    expect(isSupportedEvent('pull_request_target')).toBe(false)
    expect(isSupportedEvent('merge_group')).toBe(false)
    expect(isSupportedEvent('')).toBe(false)
  })
})

describe('unsupportedEventMessage', () => {
  it('names the event that started the workflow', () => {
    expect(unsupportedEventMessage('push')).toContain('got "push"')
  })
})
