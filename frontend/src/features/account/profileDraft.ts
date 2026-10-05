import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CustomerProfile } from "@/shared/api/customer";
export type DraftField = "firstNames" | "lastNames" | "phone" | "email";
type Draft = { value: string; original: CustomerProfile; country?: string };
const prefix = "pliego-profile-draft:";
const pendingSaves = new Set<string>();
const fallback = new Map<string, Draft>();
const fields: DraftField[] = ["firstNames", "lastNames", "phone", "email"];
function key(customerId: string, field: DraftField) { return `${prefix}${customerId}:${field}`; }
function read(customerId: string, field: DraftField): Draft | null {
  try {
    const draft = JSON.parse(sessionStorage.getItem(key(customerId, field)) ?? "null") ?? fallback.get(key(customerId, field));
    return draft && typeof draft.value === "string" && draft.original?.customerId === customerId && typeof draft.original.version === "string" ? draft : null;
  } catch { return fallback.get(key(customerId, field)) ?? null; }
}
function write(customerId: string, field: DraftField, draft: Draft | null) {
  try {
    if (draft) sessionStorage.setItem(key(customerId, field), JSON.stringify(draft));
    else sessionStorage.removeItem(key(customerId, field));
    fallback.delete(key(customerId, field));
  } catch {
    if (draft) fallback.set(key(customerId, field), draft);
    else fallback.delete(key(customerId, field));
  }
  window.dispatchEvent(new CustomEvent("pliego-profile-draft", { detail: key(customerId, field) }));
}
export function restoredProfileField(customerId: string) { return fields.find(field => read(customerId, field)) ?? null; }

/** Each field retains the version it was based on; restoration never silently rebases an old draft. */
export function useProfileDraft(profile: CustomerProfile, field: DraftField, initial: string) {
  const draft = useRef(read(profile.customerId, field)).current;
  const original = useRef(draft?.original ?? profile);
  const [value, updateValue] = useState(draft?.value ?? initial);
  const latest = useRef(value);
  const country = useRef(draft?.country);
  const [notice, setNotice] = useState(draft ? "Recuperamos tu borrador sin guardar." : "");
  const currentProfile = useRef(profile);
  currentProfile.current = profile;
  useEffect(() => {
    function changed(event: Event) {
      if ((event as CustomEvent<string>).detail !== key(profile.customerId, field)) return;
      const stored = read(profile.customerId, field);
      if (stored && stored.original.version !== original.current.version) {
        original.current = stored.original;
        setNotice("Guardamos el dato enviado. Tienes cambios nuevos sin guardar.");
      } else if (!stored) {
        original.current = currentProfile.current;
        setNotice("El dato enviado se guardó.");
      }
    }
    window.addEventListener("pliego-profile-draft", changed);
    return () => window.removeEventListener("pliego-profile-draft", changed);
  }, [profile.customerId, field]);
  useEffect(() => {
    if (!read(profile.customerId, field)) original.current = profile;
  }, [profile, field]);
  function setValue(next: string) {
    latest.current = next;
    updateValue(next);
    write(profile.customerId, field, { value: next, original: original.current, country: country.current });
    setNotice("Tienes cambios sin guardar. Conservamos tu borrador si sales de esta página.");
  }
  function setCountry(next: string) {
    country.current = next;
    write(profile.customerId, field, { value: latest.current, original: original.current, country: next });
    setNotice("Tienes cambios sin guardar. Conservamos tu borrador si sales de esta página.");
  }
  function cancel() { write(profile.customerId, field, null); }
  function complete(submitted: string, current?: CustomerProfile, keepEditing = false) {
    // A route may have unmounted this editor and restored its draft in another instance.
    const stored = read(profile.customerId, field);
    if (!stored) return true; // The reader explicitly discarded the restored draft.
    const remaining = stored.value;
    if (remaining === submitted && !keepEditing) { cancel(); return true; }
    if (current) original.current = current;
    write(profile.customerId, field, { value: remaining, original: original.current, country: stored?.country ?? country.current });
    setNotice("Guardamos el dato enviado. Tienes cambios nuevos sin guardar.");
    return false;
  }
  return { value, setValue, original, notice, cancel, complete, country, setCountry };
}

/** In-flight saves stay locked and announced when the reader leaves and returns to the editor. */
export function useProfileSaving(customerId: string, field: DraftField) {
  const saveKey = key(customerId, field);
  const saving = useSyncExternalStore(
    callback => {
      const listener = (event: Event) => { if ((event as CustomEvent<string>).detail === saveKey) callback(); };
      window.addEventListener("pliego-profile-save", listener);
      return () => window.removeEventListener("pliego-profile-save", listener);
    },
    () => pendingSaves.has(saveKey),
  );
  const [saved, setSaved] = useState(false);
  async function run(task: () => Promise<boolean>) {
    if (pendingSaves.has(saveKey)) return;
    pendingSaves.add(saveKey);
    window.dispatchEvent(new CustomEvent("pliego-profile-save", { detail: saveKey }));
    try { if (await task()) setSaved(true); }
    finally {
      pendingSaves.delete(saveKey);
      window.dispatchEvent(new CustomEvent("pliego-profile-save", { detail: saveKey }));
    }
  }
  return { saving, saved, run };
}
