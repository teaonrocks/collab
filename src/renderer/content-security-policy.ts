const directives = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://*.convex.cloud https://*.convex.site",
  "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://*.convex.site https://*.workos.com https://*.authkit.app"
] as const

export const productionContentSecurityPolicy = directives.join("; ")

export const developmentContentSecurityPolicy = [
  ...directives.slice(0, -1),
  `${directives.at(-1)} http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*`
].join("; ")
