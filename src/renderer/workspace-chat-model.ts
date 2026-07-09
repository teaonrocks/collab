import type {
  ChatChannelId,
  ChatChannelIndicator,
  ChatChannelMember,
  ChatDataModel,
  ChatMessage,
  ChatMessageId
} from "./chat-data"

export type ChannelViewModel = {
  readonly members: ReadonlyArray<ChatChannelMember>
  readonly channelIndicators: ReadonlyMap<ChatChannelId, ChatChannelIndicator>
}

export type ChannelMessageGroup = {
  readonly id: ChatMessageId
  readonly authorType: ChatMessage["authorType"]
  readonly authorId: string
  readonly authorDisplayName: string
  readonly messages: ReadonlyArray<ChatMessage>
}

export type ChannelMessageSearchResult = {
  readonly message: ChatMessage
  readonly bodyPreview: string
}

export type ChannelMessageSearchState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "empty" }
  | { readonly status: "results"; readonly results: ReadonlyArray<ChannelMessageSearchResult> }

const MENTION_SUGGESTION_LIMIT = 6
const MESSAGE_SEARCH_RESULT_LIMIT = 20
export const MESSAGE_SEARCH_MAX_QUERY_LENGTH = 120

export const createChannelViewModel = (model: ChatDataModel): ChannelViewModel => {
  const channelIndicators = new Map<ChatChannelId, ChatChannelIndicator>()
  model.channelIndicators?.forEach((state) => {
    if (state.channelId !== model.channel.id) channelIndicators.set(state.channelId, state.indicator)
  })
  return {
    members: uniqueMembers(model.channelMessages),
    channelIndicators
  }
}

const uniqueMembers = (messages: ReadonlyArray<ChatMessage>): ReadonlyArray<ChatChannelMember> => {
  const members = new Map<string, ChatChannelMember>()
  messages.forEach((message) => {
    members.set(message.authorId, { id: message.authorId, displayName: message.authorDisplayName })
  })
  return Array.from(members.values())
}

export const mergeChannelMembers = (
  members: ReadonlyArray<ChatChannelMember>,
  nextMembers: ReadonlyArray<ChatChannelMember>
): ReadonlyArray<ChatChannelMember> => {
  if (nextMembers.length === 0) return members
  const byId = new Map(members.map((member) => [member.id, member]))
  let changed = false
  nextMembers.forEach((member) => {
    if (!byId.has(member.id)) {
      changed = true
      byId.set(member.id, member)
    }
  })
  return changed ? Array.from(byId.values()) : members
}

export const filterDirectConversationCandidates = (
  candidates: ReadonlyArray<ChatChannelMember>,
  query: string
): ReadonlyArray<ChatChannelMember> => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return normalizedQuery.length === 0
    ? candidates
    : candidates.filter((candidate) => candidate.displayName.toLocaleLowerCase().includes(normalizedQuery))
}

export const searchChannelMessages = (
  messages: ReadonlyArray<ChatMessage>,
  query: string
): ChannelMessageSearchState => {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length === 0) return { status: "idle" }
  if (normalizedQuery.length > MESSAGE_SEARCH_MAX_QUERY_LENGTH) {
    return {
      status: "error",
      message: `Search is limited to ${MESSAGE_SEARCH_MAX_QUERY_LENGTH} characters.`
    }
  }

  const results = messages
    .filter((message) =>
      message.deletedAt === null &&
      (message.body.toLowerCase().includes(normalizedQuery) ||
        message.authorDisplayName.toLowerCase().includes(normalizedQuery))
    )
    .slice(0, MESSAGE_SEARCH_RESULT_LIMIT)
    .map((message) => ({ message, bodyPreview: message.body }))

  return results.length === 0
    ? { status: "empty" }
    : { status: "results", results }
}

export const getMentionRequest = (
  draft: string,
  cursorIndex: number
): { readonly triggerIndex: number; readonly cursorIndex: number; readonly query: string } | null => {
  const safeCursorIndex = Math.min(Math.max(cursorIndex, 0), draft.length)
  const beforeCursor = draft.slice(0, safeCursorIndex)
  const triggerIndex = beforeCursor.lastIndexOf("@")
  if (triggerIndex === -1) return null
  if (triggerIndex > 0 && /\S/.test(draft.charAt(triggerIndex - 1))) return null
  const query = draft.slice(triggerIndex + 1, safeCursorIndex)
  if (/\s/.test(query)) return null
  return { triggerIndex, cursorIndex: safeCursorIndex, query }
}

export const filterMentionMembers = (
  members: ReadonlyArray<ChatChannelMember>,
  query: string
): ReadonlyArray<ChatChannelMember> => {
  const normalizedQuery = query.trim().toLowerCase()
  const matches = normalizedQuery.length === 0
    ? members
    : members.filter((member) => member.displayName.toLowerCase().includes(normalizedQuery))
  return matches.slice(0, MENTION_SUGGESTION_LIMIT)
}

export const resizeTextarea = (textarea: HTMLTextAreaElement | null, minHeight: number, maxHeight: number) => {
  if (textarea === null) return
  textarea.style.height = "auto"
  const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)
  textarea.style.height = `${nextHeight}px`
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden"
}

export const formatTime = (timestamp: number): string =>
  `${formatDatePart(timestamp)} ${formatClockPart(timestamp)}`

export const formatDatePart = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${padTimePart(date.getDate())}/${padTimePart(date.getMonth() + 1)}`
}

export const formatClockPart = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`
}

const padTimePart = (value: number): string => value.toString().padStart(2, "0")

export const toIso = (timestamp: number): string => new Date(timestamp).toISOString()

export const groupConsecutiveMessages = (messages: ReadonlyArray<ChatMessage>): ReadonlyArray<ChannelMessageGroup> => {
  const groups: Array<ChannelMessageGroup> = []
  for (const message of messages) {
    const current = groups.at(-1)
    if (current !== undefined && current.authorType === message.authorType && current.authorId === message.authorId) {
      groups[groups.length - 1] = { ...current, messages: [...current.messages, message] }
    } else {
      groups.push({
        id: message.id,
        authorType: message.authorType,
        authorId: message.authorId,
        authorDisplayName: message.authorDisplayName,
        messages: [message]
      })
    }
  }
  return groups
}

export const initials = (value: string): string =>
  value.trim().split(/\s+/).map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase()
