export async function submitComposerWhenAccepted(
  send: () => boolean | Promise<boolean>,
  clear: () => void
): Promise<boolean> {
  const accepted = await send();
  if (!accepted) return false;
  clear();
  return true;
}
