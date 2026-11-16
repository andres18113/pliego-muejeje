import { useEffect, useRef, useState } from "react";
import { UndoToast, type UndoToastMessage } from "@/shared/ui/UndoToast";
import { browserVersionEnvironment, watchBuildVersion, type VersionEnvironment } from "./buildVersion";

/**
 * After a release, a tab opened earlier still runs the old code. This says so in the shared snackbar (never a
 * banner, never a forced reload): "Actualizar" reloads when the customer chooses, so nothing typed is lost; closing it
 * hides it until an even newer build is published.
 */
export function BuildUpdateNotice({ environment, reload = () => window.location.reload() }: { environment?: () => VersionEnvironment; reload?: () => void }) {
  const [toast, setToast] = useState<UndoToastMessage | null>(null);
  // Held in a ref: a new reload function on each render must never restart the watcher (it checks on start).
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => watchBuildVersion((environment ?? browserVersionEnvironment)(), () => setToast({
    key: Date.now(),
    message: "Hay una versión nueva de PLIEGO.",
    detail: "Actualiza la página cuando termines lo que estás haciendo.",
    action: { label: "Actualizar", onPress: () => reloadRef.current() },
  })), [environment]);
  // Mounted only while there is something to say: an always-present live region would add a second, empty
  // role="status" to every page of the site.
  return toast ? <UndoToast toast={toast} onDismiss={() => setToast(null)} duration={10 * 60_000} /> : null;
}
