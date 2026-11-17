// Events the gate handles. Both carry a `pull_request` object in the
// payload with the head SHA the gate evaluates.
const SUPPORTED_EVENTS = ['pull_request', 'pull_request_review'] as const

export const isSupportedEvent = (eventName: string): boolean =>
  (SUPPORTED_EVENTS as readonly string[]).includes(eventName)

export const unsupportedEventMessage = (eventName: string): string =>
  `automerge-gate only handles pull_request / pull_request_review events; got "${eventName}". Remove this event from the workflow's \`on:\` triggers.`
