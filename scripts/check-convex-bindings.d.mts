export function expectedConvexModules(convexDir: string): string[]
export function generatedConvexModules(apiDeclaration: string): string[]
export function staleConvexBindings(convexDir: string): {
  missing: string[]
  removed: string[]
}
