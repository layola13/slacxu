import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { driver, type Driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import "./onboarding.css";

export type TourRole = "solo" | "team";

export interface TourContextValue {
  driver: Driver | null;
  isActive: boolean;
  startTour: (role?: TourRole) => Promise<void>;
  replayTour: (role?: TourRole) => Promise<void>;
  stopTour: () => void;
  clearSeen: (role: TourRole) => void;
}

const TourContext = createContext<TourContextValue | null>(null);

const TOUR_VERSION = "v2_primary_controls";

function storageKey(role: TourRole) {
  return `codex_tour_${role}_${TOUR_VERSION}`;
}

function hasSeen(role: TourRole) {
  try {
    return localStorage.getItem(storageKey(role)) === "true";
  } catch {
    return false;
  }
}

function markSeen(role: TourRole) {
  try {
    localStorage.setItem(storageKey(role), "true");
  } catch {
    // ignore
  }
}

function clearSeen(role: TourRole) {
  try {
    localStorage.removeItem(storageKey(role));
  } catch {
    // ignore
  }
}

export interface TourProviderProps {
  children: React.ReactNode;
  t: (key: string) => string;
  getSteps: (role: TourRole, t: (key: string) => string) => DriveStep[];
  defaultRole: TourRole;
}

export function TourProvider({
  children,
  t,
  getSteps,
  defaultRole,
}: TourProviderProps) {
  const [active, setActive] = useState(false);
  const driverRef = useRef<Driver | null>(null);
  const completedRef = useRef(false);
  const roleRef = useRef(defaultRole);
  const getStepsRef = useRef(getSteps);
  const tRef = useRef(t);

  useEffect(() => {
    getStepsRef.current = getSteps;
    tRef.current = t;
    roleRef.current = defaultRole;
  });

  const stopTour = useCallback(() => {
    const d = driverRef.current;
    if (d) {
      try {
        d.destroy();
      } catch {
        // ignore
      }
    }
    driverRef.current = null;
    setActive(false);
  }, []);

  const startTour = useCallback(
    async (requestedRole?: TourRole) => {
      if (driverRef.current?.isActive()) return;
      const role = requestedRole ?? roleRef.current;
      roleRef.current = role;
      completedRef.current = false;

      const steps = getStepsRef.current(role, tRef.current);

      if (driverRef.current) {
        driverRef.current.destroy();
      }

      const d = driver({
        showProgress: true,
        animate: true,
        allowClose: true,
        allowKeyboardControl: true,
        skipMissingElement: true,
        waitForElement: 500,
        stagePadding: 6,
        stageRadius: 6,
        overlayColor: "rgba(0,0,0,0.6)",
        popoverClass: "codex-onboarding-popover",
        nextBtnText: tRef.current("onboarding.tour.next"),
        prevBtnText: tRef.current("onboarding.tour.prev"),
        doneBtnText: tRef.current("onboarding.tour.done"),
        onNextClick: (_el, _step, { config, state }) => {
          const total = config.steps?.length ?? 0;
          const isLast = (state.activeIndex ?? 0) === total - 1;
          if (isLast) {
            markSeen(role);
            d.destroy();
            driverRef.current = null;
            setActive(false);
          } else {
            void d.moveNext();
          }
        },
        onCloseClick: () => {
          const confirmed = window.confirm(
            tRef.current("onboarding.tour.skipConfirm")
          );
          if (!confirmed) return;
          completedRef.current = true;
          d.destroy();
          driverRef.current = null;
          setActive(false);
        },
        onDestroyed: () => {
          if (completedRef.current) markSeen(role);
          driverRef.current = null;
          setActive(false);
        },
      });

      driverRef.current = d;
      setActive(true);
      d.drive(0);
    },
    [],
  );

  const replayTour = useCallback(
    async (role?: TourRole) => {
      const resolvedRole = role ?? roleRef.current;
      clearSeen(resolvedRole);
      await startTour(resolvedRole);
    },
    [startTour],
  );

  const value = useMemo<TourContextValue>(
    () => ({
      driver: driverRef.current,
      isActive: active,
      startTour,
      replayTour,
      stopTour,
      clearSeen,
    }),
    [active, startTour, replayTour, stopTour],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour() {
  const ctx = useContext(TourContext);
  return ctx;
}

export function useOnboarding(args: {
  role: TourRole;
  shouldAutoStart: boolean;
}) {
  const { role, shouldAutoStart } = args;
  const tour = useTour();
  const { startTour, replayTour, stopTour, isActive } = tour ?? { startTour: async () => {}, replayTour: async () => {}, stopTour: () => {}, isActive: false };
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!shouldAutoStart) return;
    if (hasSeen(role)) return;
    startedRef.current = true;
    const timer = setTimeout(() => {
      void startTour(role);
    }, 1000);
    return () => clearTimeout(timer);
  }, [role, shouldAutoStart, startTour]);

  return {
    startTour: () => startTour(role),
    replayTour: () => replayTour(role),
    stopTour,
    isActive,
  };
}
