export type ChatChannelId = string
export type ChatMessageId = string

export type ChatCurrentUser = {
  readonly id: string
  readonly displayName: string
}

export type ChatWorkspace = {
  readonly name: string
}

export type ChatChannel = {
  readonly id: ChatChannelId
  readonly name: string
  readonly visibility: "public" | "private"
}

export type ChatChannelMember = {
  readonly id: string
  readonly displayName: string
  readonly role?: "admin" | "member" | "guest"
}

export type ChatChannelInviteCandidate = ChatChannelMember

export type ChatChannelIndicator = "unread" | "mentioned"

export type ChatChannelIndicatorState = {
  readonly channelId: ChatChannelId
  readonly indicator: ChatChannelIndicator
}

export type ChatMessageReaction = {
  readonly emoji: string
  readonly count: number
  readonly reactedByCurrentUser: boolean
}

export type ChatMessageAttachment = {
  readonly id: string
  readonly storageId: string
  readonly name: string
  readonly contentType: string
  readonly size: number
  readonly kind: "file" | "image"
  readonly url: string | null
}

export type ChatMessageParent = {
  readonly id: ChatMessageId
  readonly authorDisplayName: string
  readonly bodyPreview: string
  readonly deleted: boolean
}

export type ChatMessage = {
  readonly id: ChatMessageId
  readonly channelId: ChatChannelId
  readonly authorType: "human" | "agent" | "system"
  readonly authorId: string
  readonly authorDisplayName: string
  readonly body: string
  readonly createdAt: number
  readonly editedAt: number | null
  readonly deletedAt: number | null
  readonly parentMessageId: ChatMessageId | null
  readonly parentMessage: ChatMessageParent | null
  readonly reactions: ReadonlyArray<ChatMessageReaction>
  readonly attachments: ReadonlyArray<ChatMessageAttachment>
}

export type ChatDataModel = {
  readonly currentUser: ChatCurrentUser
  readonly workspace: ChatWorkspace
  readonly channel: ChatChannel
  readonly channels: ReadonlyArray<ChatChannel>
  readonly channelMessages: ReadonlyArray<ChatMessage>
  readonly channelMembers?: ReadonlyArray<ChatChannelMember>
  readonly channelMemberInviteCandidates?: ReadonlyArray<ChatChannelInviteCandidate>
  readonly createChannelInviteCandidates?: ReadonlyArray<ChatChannelInviteCandidate>
  readonly channelIndicators?: ReadonlyArray<ChatChannelIndicatorState>
  readonly channelMembersLoading?: boolean
  readonly channelMessagesLoading?: boolean
  readonly channelMessagesHasMore?: boolean
  readonly channelMessagesLoadingMore?: boolean
}

export type CreateChatChannel = (input: {
  readonly name: string
  readonly visibility?: ChatChannel["visibility"]
  readonly initialMemberIds?: ReadonlyArray<ChatChannelInviteCandidate["id"]>
}) => Promise<ChatChannel>

export type SelectChatChannel = (channelId: ChatChannelId) => void

export type AddChatChannelMember = (input: {
  readonly channelId: ChatChannelId
  readonly userId: ChatChannelMember["id"]
}) => Promise<unknown>

export type RemoveChatChannelMember = AddChatChannelMember

export type CreateChatMessage = (input: {
  readonly channelId: ChatChannelId
  readonly body: string
  readonly parentMessageId?: ChatMessageId | null
  readonly attachments?: ReadonlyArray<ChatMessageAttachment>
}) => Promise<unknown>

export type UploadChatMessageAttachment = (file: File) => Promise<ChatMessageAttachment>

export type EditChatMessage = (input: {
  readonly channelId: ChatChannelId
  readonly messageId: ChatMessageId
  readonly body: string
}) => Promise<unknown>

export type DeleteChatMessage = (input: {
  readonly channelId: ChatChannelId
  readonly messageId: ChatMessageId
}) => Promise<unknown>

export type ToggleChatMessageReaction = (input: {
  readonly channelId: ChatChannelId
  readonly messageId: ChatMessageId
  readonly emoji: string
}) => Promise<unknown>

export type SearchChatMessages = (input: {
  readonly channelId: ChatChannelId
  readonly query: string
}) => Promise<ReadonlyArray<ChatMessage>>

export type ChatMessageGuard = (message: ChatMessage) => boolean
export type ChatOperation = "send" | "edit" | "delete" | "react" | "attach"
export type ChatOperationErrorMessage = (operation: ChatOperation, cause: unknown) => string

export type ChatDataView = {
  readonly model: ChatDataModel
  readonly createChannel?: CreateChatChannel
  readonly selectChannel?: SelectChatChannel
  readonly addChannelMember?: AddChatChannelMember
  readonly removeChannelMember?: RemoveChatChannelMember
  readonly createChannelMessage: CreateChatMessage
  readonly uploadMessageAttachment?: UploadChatMessageAttachment
  readonly discardMessageAttachment?: (attachment: ChatMessageAttachment) => Promise<unknown>
  readonly deleteChannelMessage: DeleteChatMessage
  readonly editChannelMessage?: EditChatMessage
  readonly toggleMessageReaction?: ToggleChatMessageReaction
  readonly searchChannelMessages?: SearchChatMessages
  readonly loadOlderChannelMessages?: () => void
  readonly canDeleteMessages?: boolean
  readonly canDeleteMessage?: ChatMessageGuard
  readonly canEditMessage?: ChatMessageGuard
  readonly operationErrorMessage?: ChatOperationErrorMessage
}
