import { useState } from "react";

/**
 * Owns the desktop CLI prerequisite gate. While blocked, App must not start
 * auth/engine work and must render CliPrerequisiteScreen instead.
 */
export function useCliPrerequisites() {
  const [cliPrerequisitesComplete, setCliPrerequisitesComplete] = useState(false);
  const cliPrerequisiteScreenEnabled = Boolean(
    window.codexUltraDesktop?.cliPrerequisitesRequired && window.codexUltraDesktop?.checkCliPrerequisites
  );
  const cliPrerequisitesBlocked = cliPrerequisiteScreenEnabled && !cliPrerequisitesComplete;
  return {
    cliPrerequisiteScreenEnabled,
    cliPrerequisitesComplete,
    cliPrerequisitesBlocked,
    markCliPrerequisitesComplete: () => setCliPrerequisitesComplete(true),
  };
}
