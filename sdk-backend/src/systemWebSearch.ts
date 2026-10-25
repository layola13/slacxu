/** System web search is a bounded product capability, not an arbitrary model URL request. */
export function isSystemWebSearchPermissionRequest(details: string): boolean {
  return /\b(?:web\s+search|search|browser|bing|google|duckduckgo)\b/i.test(details);
}
