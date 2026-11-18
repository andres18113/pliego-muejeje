import type { Plugin } from "vite";
import { apiOriginFrom } from "../src/shared/api/apiOrigin";
import { OFFER_REFRESH_PATH, OFFER_REFRESH_REQUEST } from "../src/shared/api/offerRefreshRequest";

/** Where index.html receives the tags; a missing marker fails the build rather than silently losing the early clock. */
export const EARLY_OFFER_CLOCK_MARKER = "<!-- pliego:early-offer-clock -->";

/**
 * ADR 0058 asks the server for the offer clock before any price read. The bundle used to send it only after the
 * whole entry graph had downloaded and run (≈3.5 s on a slow phone), and every price read and the first render wait
 * for its answer. This inline request leaves while that code is still downloading; `primeOfferRefreshClock` adopts
 * its answer (with the moment it arrived, for the server-relative schedule) and sends its own only if it never came.
 * The order is unchanged: price reads still start only after this first answer.
 *
 * For a cross-origin API it also warms the credentialed connection the session restore and the data reads use; the
 * clock (credentials omitted) opens its own, so the two never wait on one cold connection in turn.
 */
export function earlyOfferClockHtml(configuredApiBase: string | undefined) {
  const origin = apiOriginFrom(configuredApiBase);
  const url = `${origin}${OFFER_REFRESH_PATH}`;
  const script = "(function(){try{window.__pliegoOfferClock=fetch(" + JSON.stringify(url) + "," + JSON.stringify(OFFER_REFRESH_REQUEST)
    + ").then(function(r){return r.text().then(function(b){return{ok:r.ok,status:r.status,body:b,receivedAt:performance.now()};});})"
    + ".catch(function(){return null;});}catch(e){}})();";
  const preconnect = /^https?:\/\//.test(origin) ? `<link rel="preconnect" href="${origin}" crossorigin="use-credentials" />\n    ` : "";
  return `${preconnect}<script>${script}</script>`;
}

export function earlyOfferClock(): Plugin {
  let apiBase: string | undefined;
  return {
    name: "pliego-early-offer-clock",
    configResolved(config) { apiBase = config.env.VITE_API_BASE_URL; },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (!html.includes(EARLY_OFFER_CLOCK_MARKER)) throw new Error(`index.html needs ${EARLY_OFFER_CLOCK_MARKER} for the early offer clock (ADR 0058).`);
        return html.replace(EARLY_OFFER_CLOCK_MARKER, earlyOfferClockHtml(apiBase));
      },
    },
  };
}
