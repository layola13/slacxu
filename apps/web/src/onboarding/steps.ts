import type { DriveStep } from "driver.js";

const NEW_TASK_SELECTOR = '[data-testid="new-task-tab-button"]';
const RUNTIME_SELECTOR = '[data-testid="composer-runtime-controls"]';
const COMPOSER_SELECTOR = '[data-testid="composer-input"]';
const AGENTS_SELECTOR = '[data-testid="composer-agents-button"]';
const IMMERSIVE_SELECTOR = '[data-testid="immersive-view-toggle"]';

function navigationButtons(first = false): Array<"next" | "previous"> {
  return first ? ["next"] : ["previous", "next"];
}

export function getSteps(role: "solo" | "team", t: (k: string) => string): DriveStep[] {
  const soloSteps: DriveStep[] = [
    {
      popover: {
        title: t("onboarding.tour.welcome.title"),
        description: t("onboarding.tour.welcome.description"),
        align: "center",
        showButtons: navigationButtons(true),
      },
    },
    {
      element: NEW_TASK_SELECTOR,
      popover: {
        title: t("onboarding.tour.newChat.title"),
        description: t("onboarding.tour.newChat.description"),
        side: "bottom",
        align: "end",
        showButtons: navigationButtons(),
      },
    },
    {
      element: RUNTIME_SELECTOR,
      popover: {
        title: t("onboarding.tour.relay.title"),
        description: t("onboarding.tour.relay.description"),
        side: "bottom",
        align: "start",
        showButtons: navigationButtons(),
      },
    },
    {
      element: COMPOSER_SELECTOR,
      popover: {
        title: t("onboarding.tour.test.title"),
        description: t("onboarding.tour.test.description"),
        side: "top",
        align: "start",
        showButtons: navigationButtons(),
      },
    },
    {
      element: IMMERSIVE_SELECTOR,
      popover: {
        title: t("onboarding.tour.immersiveEnter.title"),
        description: t("onboarding.tour.immersiveEnter.description"),
        side: "bottom",
        align: "center",
        showButtons: navigationButtons(),
      },
    },
    {
      popover: {
        title: t("onboarding.tour.done.title"),
        description: t("onboarding.tour.done.description"),
        align: "center",
        showButtons: navigationButtons(),
        doneBtnText: t("onboarding.tour.done"),
      },
    },
  ];

  if (role === "team") {
    const teamStep: DriveStep = {
      element: AGENTS_SELECTOR,
      popover: {
        title: t("onboarding.tour.auth.title"),
        description: t("onboarding.tour.auth.description"),
        side: "top",
        align: "center",
        showButtons: navigationButtons(),
      },
    };
    soloSteps.splice(4, 0, teamStep);
  }

  return soloSteps;
}

export function filterAvailableSteps(
  steps: DriveStep[],
  isAvailable: (selector: string) => boolean = isVisibleSelector,
): DriveStep[] {
  return steps.filter((step) => typeof step.element !== "string" || isAvailable(step.element));
}

function isVisibleSelector(selector: string): boolean {
  const element = document.querySelector(selector);
  if (!element) return false;
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
}
