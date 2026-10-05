import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// jsdom has no media-query API; Mantine's shared provider subscribes to it.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false,
  });
}

// jsdom has no Web Locks. Serialize this browser boundary as Chromium does in E2E.
if (!navigator.locks) {
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: <T,>(name: string, callback: () => T | Promise<T>) => {
      const result = (queues.get(name) ?? Promise.resolve()).catch(() => undefined).then(callback);
      queues.set(name, result);
      return result;
    },
  } });
}

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

// jsdom has no layout: Mantine's combobox scrolls its active option into view when a list opens.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
