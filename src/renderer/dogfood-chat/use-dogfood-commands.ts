import { useConvex, useMutation } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { uploadAttachment } from "../attachment-draft"
import type { DogfoodChatAdapterInput, DogfoodWorkspaceView } from "../dogfood-chat-adapter"
import type { DogfoodConversationSelection } from "./use-conversation-selection"

type CommandInput = {
  readonly workspace: DogfoodWorkspaceView | null | undefined
  readonly selection: DogfoodConversationSelection
  readonly loadOlderMessages: () => void
  readonly operationErrorMessage: NonNullable<DogfoodChatAdapterInput["commands"]["operationErrorMessage"]>
}

export function useDogfoodCommands({
  workspace,
  selection,
  loadOlderMessages,
  operationErrorMessage
}: CommandInput): DogfoodChatAdapterInput["commands"] {
  const convex = useConvex()
  const sendMessage = useMutation(api.chat.sendMessage)
  const editMessage = useMutation(api.chat.editMessage)
  const deleteMessage = useMutation(api.chat.deleteMessage)
  const toggleMessageReaction = useMutation(api.chat.toggleMessageReaction)
  const createChannel = useMutation(api.chat.createChannel)
  const editChannel = useMutation(api.chat.editChannel)
  const deleteChannel = useMutation(api.chat.deleteChannel)
  const addPrivateChannelMember = useMutation(api.chat.addPrivateChannelMember)
  const removePrivateChannelMember = useMutation(api.chat.removePrivateChannelMember)
  const generateAttachmentUploadUrl = useMutation(api.chat.generateAttachmentUploadUrl)
  const registerAttachmentUpload = useMutation(api.chat.registerAttachmentUpload)
  const deleteAttachmentUpload = useMutation(api.chat.deleteAttachmentUpload)
  const startOrReopenDirectConversation = useMutation(api.direct_conversations.startOrReopen)
  const sendFriendRequest = useMutation(api.social.sendFriendRequest)
  const updateDirectMessageProfile = useMutation(api.social.updateProfile)
  const respondToFriendRequest = useMutation(api.social.respondToFriendRequest)
  const updateNotificationPreference = useMutation(api.notification_preferences.updatePreference)

  return {
    loadOlderMessages,
    createChannel: async (input) => {
      const channel = await createChannel(input)
      selection.recordCreatedChannel(channel)
      return channel
    },
    selectChannel: selection.selectChannel,
    selectDirectConversation: selection.selectDirectConversation,
    startDirectConversation: async (recipientUserId) => {
      const conversation = await startOrReopenDirectConversation({ recipientUserId })
      selection.recordDirectConversation(conversation)
      return conversation
    },
    searchDirectConversationCandidates: (query) => convex.query(api.social.searchUsers, { query }),
    sendFriendRequest,
    updateDirectMessageProfile,
    respondToFriendRequest,
    updateNotificationPreference,
    editChannel,
    deleteChannel: async (input) => {
      await deleteChannel(input)
      selection.recordDeletedChannel(input.channelId)
    },
    addChannelMember: addPrivateChannelMember,
    removeChannelMember: async (input) => {
      const result = await removePrivateChannelMember(input)
      if (workspace?.currentUser.id === input.userId) selection.recordSelfRemoved(input.channelId)
      return result
    },
    sendMessage,
    uploadMessageAttachment: (file) =>
      uploadAttachment({
        file,
        generateUploadUrl: () => generateAttachmentUploadUrl({}),
        register: (input) => registerAttachmentUpload(input),
        deleteUpload: (input) => deleteAttachmentUpload(input),
        storageIdFromResponse,
        storageIdToString: String
      }),
    discardMessageAttachment: deleteAttachmentUpload,
    editMessage,
    deleteMessage,
    toggleMessageReaction,
    searchMessages: (input) => convex.query(api.chat.searchChannelMessages, input),
    operationErrorMessage
  }
}

const storageIdFromResponse = (body: unknown): Id<"_storage"> => {
  if (typeof body !== "object" || body === null || !("storageId" in body)) {
    throw new Error("Attachment upload did not return a storage id")
  }
  const storageId = body.storageId
  if (typeof storageId !== "string" || storageId.length === 0) {
    throw new Error("Attachment upload did not return a storage id")
  }
  return storageId as Id<"_storage">
}
