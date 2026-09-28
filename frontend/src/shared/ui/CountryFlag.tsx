import type { CountryCode } from "libphonenumber-js/min";

const flagFiles = import.meta.glob<string>("../../../node_modules/country-flag-icons/3x2/*.svg", {
  eager: true,
  import: "default",
  query: "?url&no-inline",
});
const flagUrls = Object.fromEntries(Object.entries(flagFiles).map(([path, url]) => [
  path.slice(path.lastIndexOf("/") + 1, -4), url,
])) as Record<string, string>;

export function CountryFlag({ code, className }: { code: CountryCode | string; className?: string }) {
  const src = /^[A-Z]{2}$/.test(code) ? flagUrls[code] : undefined;
  if (!src) return null;
  return <img className={className ?? "country-flag"} src={src} alt="" aria-hidden="true" width="24" height="16" loading="lazy" decoding="async" />;
}
