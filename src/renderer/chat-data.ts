export type ChatChannelId = string
export type ChatMessageId = string

type ChatCurrentUser = {
  readonly id: string
  readonly displayName: string
}

type ChatWorkspace = {
  readonly name: string
}

export type ChatChannel = {
  readonly id: ChatChannelId
  readonly name: string
  readonly visibility: "public" | "private"
}

export type ChatDirectConversation = {
  readonly id: ChatChannelId
  readonly otherUser: ChatChannelMember
}

export type ChatDirectMessageProfile = {
  readonly username: string | null
  readonly directMessagePreference: "all" | "mutuals" | "friends"
}

type ChatIncomingFriendRequest = {
  readonly id: string
  readonly requester: { readonly id: string; readonly displayName: string; readonly username: string | null }
}

export type ChatActiveConversation =
  | { readonly kind: "channel"; readonly channel: ChatChannel }
  | { readonly kind: "direct"; readonly directConversation: ChatDirectConversation }

export const activeConversationId = (conversation: ChatActiveConversation): ChatChannelId =>
  conversation.kind === "channel" ? conversation.channel.id : conversation.directConversation.id

export const activeConversationName = (conversation: ChatActiveConversation): string =>
  conversation.kind === "channel" ? conversation.channel.name : conversation.directConversation.otherUser.displayName

export type ChatChannelMember = {
  readonly id: string
  readonly displayName: string
  readonly username?: string | null
  readonly canStartDirectMessage?: boolean
  readonly friendship?: "pending" | "accepted" | "declined" | null
  readonly friendRequestDirection?: "incoming" | "outgoing" | null
  readonly role?: "admin" | "member" | "guest"
}

export type ChatChannelInviteCandidate = ChatChannelMember

export type ChatChannelIndicator = "unread" | "mentioned"

type ChatChannelIndicatorState = {
  readonly channelId: ChatChannelId
  readonly indicator: ChatChannelIndicator
}

export type ChatConversationNotificationMode = "all" | "mentions" | "off"

type ChatConversationNotificationPreference = {
  readonly mode: ChatConversationNotificationMode
  readonly options: ReadonlyArray<ChatConversationNotificationMode>
}

type ChatMessageReaction = {
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

type ChatMessageParent = {
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
  readonly activeConversation: ChatActiveConversation
  readonly channels: ReadonlyArray<ChatChannel>
  readonly directConversations: ReadonlyArray<ChatDirectConversation>
  readonly directConversationsLoading?: boolean
  readonly directMessageProfile?: ChatDirectMessageProfile
  readonly incomingFriendRequests?: ReadonlyArray<ChatIncomingFriendRequest>
  readonly channelMessages: ReadonlyArray<ChatMessage>
  readonly channelMembers?: ReadonlyArray<ChatChannelMember>
  readonly channelMemberInviteCandidates?: ReadonlyArray<ChatChannelInviteCandidate>
  readonly createChannelInviteCandidates?: ReadonlyArray<ChatChannelInviteCandidate>
  readonly channelIndicators?: ReadonlyArray<ChatChannelIndicatorState>
  readonly notificationPreference?: ChatConversationNotificationPreference
  readonly channelMembersLoading?: boolean
  readonly channelMessagesLoading?: boolean
  readonly channelMessagesHasMore?: boolean
  readonly channelMessagesLoadingMore?: boolean
}

type CreateChatChannel = (input: {
  readonly name: string
  readonly visibility?: ChatChannel["visibility"]
  readonly initialMemberIds?: ReadonlyArray<ChatChannelInviteCandidate["id"]>
}) => Promise<ChatChannel>

export type SelectChatChannel = (channelId: ChatChannelId) => void
type SelectChatDirectConversation = (conversationId: ChatChannelId) => void
type StartChatDirectConversation = (recipientUserId: ChatChannelMember["id"]) => Promise<ChatDirectConversation>
type SearchChatDirectConversationCandidates = (query: string) => Promise<ReadonlyArray<ChatChannelMember>>
type SendChatFriendRequest = (recipientUserId: ChatChannelMember["id"]) => Promise<unknown>
type UpdateChatDirectMessageProfile = (input: ChatDirectMessageProfile) => Promise<ChatDirectMessageProfile>
type RespondToChatFriendRequest = (input: { readonly friendRequestId: string; readonly accept: boolean }) => Promise<unknown>
type UpdateChatConversationNotificationPreference = (input: {
  readonly channelId: ChatChannelId
  readonly mode: ChatConversationNotificationMode
}) => Promise<ChatConversationNotificationPreference>

type EditChatChannel = (input: {
  readonly channelId: ChatChannelId
  readonly name: string
}) => Promise<ChatChannel>

type DeleteChatChannel = (input: { readonly channelId: ChatChannelId }) => Promise<unknown>

type AddChatChannelMember = (input: {
  readonly channelId: ChatChannelId
  readonly userId: ChatChannelMember["id"]
}) => Promise<unknown>

type RemoveChatChannelMember = AddChatChannelMember

type CreateChatMessage = (input: {
  readonly channelId: ChatChannelId
  readonly body: string
  readonly parentMessageId?: ChatMessageId | null
  readonly attachments?: ReadonlyArray<ChatMessageAttachment>
}) => Promise<unknown>

export type UploadChatMessageAttachment = (file: File) => Promise<ChatMessageAttachment>

type EditChatMessage = (input: {
  readonly channelId: ChatChannelId
  readonly messageId: ChatMessageId
  readonly body: string
}) => Promise<unknown>

type DeleteChatMessage = (input: {
  readonly channelId: ChatChannelId
  readonly messageId: ChatMessageId
}) => Promise<unknown>

type ToggleChatMessageReaction = (input: {
  readonly channelId: ChatChannelId
  readonly messageId: ChatMessageId
  readonly emoji: string
}) => Promise<unknown>

type SearchChatMessages = (input: {
  readonly channelId: ChatChannelId
  readonly query: string
}) => Promise<ReadonlyArray<ChatMessage>>

export type ChatMessageGuard = (message: ChatMessage) => boolean
type ChatOperation = "send" | "edit" | "delete" | "react" | "attach"
export type ChatOperationErrorMessage = (operation: ChatOperation, cause: unknown) => string

export type ChatDataView = {
  readonly model: ChatDataModel
  readonly createChannel?: CreateChatChannel
  readonly editChannel?: EditChatChannel
  readonly deleteChannel?: DeleteChatChannel
  readonly selectChannel?: SelectChatChannel
  readonly selectDirectConversation?: SelectChatDirectConversation
  readonly startDirectConversation?: StartChatDirectConversation
  readonly searchDirectConversationCandidates?: SearchChatDirectConversationCandidates
  readonly sendFriendRequest?: SendChatFriendRequest
  readonly updateDirectMessageProfile?: UpdateChatDirectMessageProfile
  readonly respondToFriendRequest?: RespondToChatFriendRequest
  readonly updateNotificationPreference?: UpdateChatConversationNotificationPreference
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
