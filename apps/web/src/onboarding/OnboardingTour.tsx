import type { ReactNode } from "react";
import { TourProvider, useOnboarding, type TourRole } from "./useOnboarding";
import { filterAvailableSteps, getSteps } from "./steps";

interface OuterProps {
  t: (key: string) => string;
  role: TourRole;
  shouldAutoStart: boolean;
  children: ReactNode;
}

interface InnerProps {
  role: TourRole;
  shouldAutoStart: boolean;
  children: ReactNode;
}

function TourInitiator({ role, shouldAutoStart, children }: InnerProps) {
  useOnboarding({ role, shouldAutoStart });
  return <>{children}</>;
}

export function OnboardingTour({ t, role, shouldAutoStart, children }: OuterProps) {
  return (
    <TourProvider defaultRole={role} t={t} getSteps={(tourRole, translate) => filterAvailableSteps(getSteps(tourRole, translate))}>
      <TourInitiator role={role} shouldAutoStart={shouldAutoStart}>
        {children}
      </TourInitiator>
    </TourProvider>
  );
}
