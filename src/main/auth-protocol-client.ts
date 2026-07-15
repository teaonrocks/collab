import { resolve } from "node:path"

export type ProtocolClientRegistration = {
  readonly executablePath?: string
  readonly args?: ReadonlyArray<string>
}

export const authProtocolClientRegistration = ({
  argv,
  defaultApp,
  executablePath,
  packaged,
  platform
}: {
  readonly argv: ReadonlyArray<string>
  readonly defaultApp: boolean
  readonly executablePath: string
  readonly packaged: boolean
  readonly platform: NodeJS.Platform
}): ProtocolClientRegistration | null => {
  if (platform === "darwin") {
    return packaged ? {} : null
  }
  if (!defaultApp) return {}

  const appEntryPoint = argv[1]
  return appEntryPoint === undefined
    ? null
    : { executablePath, args: [resolve(appEntryPoint)] }
}
