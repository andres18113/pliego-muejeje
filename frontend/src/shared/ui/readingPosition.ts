/**
 * Moves focus to a page heading as a reading position for assistive technology, never as a control: the focus is
 * marked so it draws no ring (`[data-route-focus]` in styles.css), and the mark leaves with the focus. Keyboard focus
 * on controls is unchanged.
 */
export function focusReadingPosition(heading: HTMLElement) {
  heading.tabIndex = -1;
  heading.setAttribute("data-route-focus", "");
  heading.addEventListener("blur", () => heading.removeAttribute("data-route-focus"), { once: true });
  heading.focus({ preventScroll: true });
}
