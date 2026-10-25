export function shouldOpenComposerAddMenu(previousText: string, nextText: string): boolean {
  return previousText.length === 0 && nextText === "@";
}
