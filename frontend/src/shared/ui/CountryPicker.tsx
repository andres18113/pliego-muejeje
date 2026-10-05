import { Drawer, FocusTrap, Popover } from "@mantine/core";
import { useMediaQuery, useReducedMotion } from "@mantine/hooks";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CountryReference } from "@/shared/api/reference";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { CountryFlag } from "./CountryFlag";
import classes from "./CountryPicker.module.css";

/**
 * PLIEGO's country choice: a field-shaped trigger (flag + value) that opens one search field over one list.
 * Desktop anchors a compact panel to the trigger; phones get a bottom sheet with taller rows. The panel's
 * search is the only search chrome; the list is a listbox driven from that field (arrows, Page keys, Enter,
 * Escape), keeps the selected country in view and marks it (ultramar + check). Escape, a choice or a click
 * outside close it and return focus to the trigger.
 */
export function CountryPicker({
  id,
  label,
  countries,
  value,
  onChange,
  disabled = false,
  invalid = false,
  describedBy,
  valueContent,
  optionDetail,
  searchTerms,
  searchPlaceholder = "Busca un país",
  className,
  hideLabel = false,
}: {
  id: string;
  label: string;
  countries: CountryReference[];
  value: string;
  onChange: (countryCode: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** What the trigger shows for the selected country (defaults to flag + name). */
  valueContent?: (country: CountryReference) => ReactNode;
  /** Quiet detail at the end of each option (e.g. the calling code). */
  optionDetail?: (country: CountryReference) => string;
  /** Extra text a search may match (e.g. the calling code). */
  searchTerms?: (country: CountryReference) => string;
  searchPlaceholder?: string;
  className?: string;
  hideLabel?: boolean;
}) {
  const phone = useMediaQuery("(max-width: 599px)") ?? false;
  const reduceMotion = useReducedMotion();
  const [opened, setOpened] = useState(false);
  // Keyboard opening goes straight to the search; a tap on a phone does not raise the on-screen keyboard.
  const [byKeyboard, setByKeyboard] = useState(false);
  const [sheetReady, setSheetReady] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // Closing (Escape, a choice, Cerrar, a click outside) returns focus to the trigger without scrolling, unless the
  // person has already moved focus somewhere else on the page.
  useEffect(() => {
    if (wasOpen.current && !opened) {
      const frame = requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body || active.closest("[data-country-panel]")) triggerRef.current?.focus({ preventScroll: true });
      });
      wasOpen.current = opened;
      return () => cancelAnimationFrame(frame);
    }
    wasOpen.current = opened;
  }, [opened]);
  const labelId = `${id}-label`;
  const panelId = `${id}-panel`;
  const selected = countries.find((country) => country.code === value) ?? null;
  const choose = (code: string) => { onChange(code); setOpened(false); };

  const trigger = <button
    ref={triggerRef}
    type="button"
    id={id}
    role="combobox"
    aria-haspopup="dialog"
    aria-expanded={opened}
    aria-controls={opened ? panelId : undefined}
    aria-labelledby={labelId}
    aria-invalid={invalid || undefined}
    aria-describedby={describedBy}
    disabled={disabled}
    data-open={opened || undefined}
    className={`country-picker-trigger ${classes.trigger}${className ? ` ${className}` : ""}`}
    onClick={(event) => { setByKeyboard(event.detail === 0); setOpened((open) => !open); }}
    onKeyDown={(event) => {
      // Arrow keys open the list, as on a native select.
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !opened) { event.preventDefault(); setByKeyboard(true); setOpened(true); }
    }}
  >
    <span className={classes.value}>{selected
      ? valueContent?.(selected) ?? <><CountryFlag code={selected.code} className={classes.flag} /><span className={classes.valueText}>{selected.name}</span></>
      : <span className={classes.placeholder}>Elige un país</span>}</span>
    <MaterialSymbol name="expand_more" className={`country-picker-chevron ${classes.chevron}`} aria-hidden="true" size={20} />
  </button>;

  const list = <CountryList
    id={id} label={label} countries={countries} value={value} onChoose={choose} onDismiss={() => setOpened(false)}
    optionDetail={optionDetail} searchTerms={searchTerms} placeholder={searchPlaceholder} autoFocus={!phone || byKeyboard} sheet={phone}
  />;

  return <>
    <label id={labelId} htmlFor={id} className={`country-picker-label ${classes.label}${hideLabel ? " visually-hidden" : ""}`}>{label}</label>
    {/* The trigger stays in one place across the phone breakpoint, so rotating a device never remounts it. */}
    <Popover
      opened={opened && !phone} onChange={setOpened} position="bottom-start" offset={6} width="target" returnFocus withRoles={false} hideDetached={false}
      withinPortal zIndex={300} middlewares={{ flip: true, shift: { padding: 12 } }}
      transitionProps={{ transition: "fade-down", duration: reduceMotion ? 0 : 140 }}
    >
      <Popover.Target>{trigger}</Popover.Target>
      <Popover.Dropdown id={phone ? undefined : panelId} role="dialog" aria-label={label} className={classes.panel} data-country-panel="">{!phone && list}</Popover.Dropdown>
    </Popover>
    {/* The sheet traps focus only once it has slid in: focusing inside it while it is still below the screen
        would scroll the page under it. */}
    <Drawer.Root
      opened={opened && phone} onClose={() => setOpened(false)} position="bottom" size="min(85dvh, 640px)" trapFocus={false} returnFocus
      transitionProps={{ duration: reduceMotion ? 0 : 220, onEntered: () => setSheetReady(true), onExited: () => setSheetReady(false) }}
      classNames={{ content: classes.sheet, header: classes.sheetHeader, title: classes.sheetTitle, body: classes.sheetBody, close: classes.sheetClose }}
    >
      <Drawer.Overlay />
      <Drawer.Content id={phone ? panelId : undefined} data-country-panel="">
        <FocusTrap active={sheetReady}>
          <div className={classes.sheetFrame}>
            <Drawer.Header>
              <Drawer.Title>{label}</Drawer.Title>
              <Drawer.CloseButton aria-label="Cerrar" />
            </Drawer.Header>
            <Drawer.Body>{phone && list}</Drawer.Body>
          </div>
        </FocusTrap>
      </Drawer.Content>
    </Drawer.Root>
  </>;
}

function revealOption(list: HTMLElement | null, optionId: string, center: boolean) {
  const option = list ? document.getElementById(optionId) : null;
  if (!list || !option) return;
  const top = option.offsetTop, bottom = top + option.offsetHeight;
  if (center) list.scrollTop = top - (list.clientHeight - option.offsetHeight) / 2;
  else if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");

function CountryList({ id, label, countries, value, onChoose, onDismiss, optionDetail, searchTerms, placeholder, autoFocus, sheet }: {
  id: string;
  label: string;
  countries: CountryReference[];
  value: string;
  onChoose: (code: string) => void;
  onDismiss: () => void;
  optionDetail?: (country: CountryReference) => string;
  searchTerms?: (country: CountryReference) => string;
  placeholder: string;
  autoFocus: boolean;
  sheet: boolean;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // The anchored panel focuses its search only once it is placed, without scrolling the page: focusing
  // before positioning would jump to the top and detach the panel from a trigger lower on the page.
  useEffect(() => {
    if (!autoFocus || sheet) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const listId = `${id}-listbox`;
  const optionId = (code: string) => `${id}-option-${code}`;
  const visible = useMemo(() => {
    const needle = normalize(query.trim()).replace(/^\+/, "");
    if (!needle) return countries;
    return countries.filter((country) => normalize(`${country.name} ${country.code} ${searchTerms?.(country) ?? ""}`).includes(needle));
  }, [countries, query, searchTerms]);
  const selectedIndex = visible.findIndex((country) => country.code === value);
  const [active, setActive] = useState(Math.max(0, selectedIndex));
  const activeCountry = visible[Math.min(active, visible.length - 1)];

  // A new search starts on its first match; clearing it returns to the selected country.
  useEffect(() => { setActive(query.trim() ? 0 : Math.max(0, selectedIndex)); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  // Open on the selected country, centered, so the current choice is visible without scrolling; then keep
  // the keyboard row in view. Only the list scrolls — never the page behind the panel.
  useEffect(() => {
    if (selectedIndex >= 0) revealOption(listRef.current, optionId(visible[selectedIndex].code), true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (activeCountry) revealOption(listRef.current, optionId(activeCountry.code), false);
  }, [activeCountry?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const last = visible.length - 1;
    const move = (to: number) => { event.preventDefault(); setActive(Math.max(0, Math.min(last, to))); };
    if (event.key === "ArrowDown") move(active + 1);
    else if (event.key === "ArrowUp") move(active - 1);
    else if (event.key === "PageDown") move(active + 6);
    else if (event.key === "PageUp") move(active - 6);
    else if (event.key === "Enter") { event.preventDefault(); if (activeCountry) onChoose(activeCountry.code); }
    else if (event.key === "Tab") { event.preventDefault(); onDismiss(); }
    // The panel is portalled but still inside its form in React's tree: keep Escape from also cancelling that form.
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onDismiss(); }
  }

  const count = visible.length;
  return <div className={classes.body} data-sheet={sheet || undefined}>
    <div className={classes.search}>
      <MaterialSymbol name="search" aria-hidden="true" size={20} className={classes.searchIcon} />
      <input
        className={classes.searchInput}
        role="combobox"
        aria-label={`Buscar ${label.toLowerCase()}`}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeCountry ? optionId(activeCountry.code) : undefined}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        value={query}
        ref={inputRef}
        data-autofocus={(autoFocus && sheet) || undefined}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
    </div>
    <div ref={listRef} role="listbox" id={listId} aria-label={label} className={classes.list} hidden={count === 0}>
      {visible.map((country, index) => {
        const isSelected = country.code === value;
        return <div
          key={country.code}
          id={optionId(country.code)}
          role="option"
          aria-selected={isSelected}
          data-active={index === active || undefined}
          className={classes.option}
          onMouseMove={() => { if (index !== active) setActive(index); }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(country.code)}
        >
          <CountryFlag code={country.code} className={classes.flag} />
          <span className={classes.optionName}>{country.name}</span>
          {optionDetail && <span className={classes.optionDetail}>{optionDetail(country)}</span>}
          <MaterialSymbol name="check" aria-hidden="true" size={18} className={classes.check} />
        </div>;
      })}
    </div>
    {count === 0 && <p className={classes.empty}>No encontramos «{query.trim()}». Prueba con otro nombre{optionDetail ? " o con el código" : ""}.</p>}
    <span className="visually-hidden" role="status" aria-live="polite">{query.trim() ? count === 1 ? "1 país" : `${count} países` : ""}</span>
  </div>;
}
