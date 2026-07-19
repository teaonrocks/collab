export const MESSAGE_REACTION_EMOJIS = ["👍", "🎉", "👀"] as const

export type MessageReactionEmoji = typeof MESSAGE_REACTION_EMOJIS[number]

export const isMessageReactionEmoji = (emoji: string): emoji is MessageReactionEmoji =>
  MESSAGE_REACTION_EMOJIS.some((supported) => supported === emoji)
