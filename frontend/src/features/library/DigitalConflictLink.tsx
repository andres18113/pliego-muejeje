import { ButtonLink } from "@/components/ui/button";
import type { DigitalEligibility } from "@/shared/api/digitalEligibility";
import { digitalConflictDestination, isDigitalConflict } from "./digitalPurchaseState";

export function DigitalConflictLink({ reason, eligibility }: { reason?: string | null; eligibility?: DigitalEligibility }) {
  if (!isDigitalConflict(reason)) return null;
  const destination = digitalConflictDestination(reason, eligibility);
  return <ButtonLink variant="text" to={destination.href}>{destination.label}</ButtonLink>;
}
