import { Drawer, FocusTrap, Popover } from "@mantine/core";
import { useMediaQuery, useReducedMotion } from "@mantine/hooks";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import type { CountryReference } from "@/shared/api/reference";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { CountryFlag } from "./CountryFlag";
import classes from "./CountryPicker.module.css";

/** One choice of a `SearchPicker`: a stable code and the name a person reads and searches. */
export type PickerOption = { code: string; name: string };
/** How a picker names its things: the empty trigger, the result count and the no-match hint. */
export type PickerWording = { choose: string; one: string; many: string; noMatch: string };

const countryWording: PickerWording = { choose: "Elige un país", one: "país", many: "países", noMatch: "Prueba con otro nombre" };

/**
 * PLIEGO's country choice: the shared `SearchPicker` with a flag before every name.
 */
export function CountryPicker({ countries, searchPlaceholder = "Busca un país", valueContent, optionDetail, ...props }: {
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
  return <SearchPicker {...props} options={countries} searchPlaceholder={searchPlaceholder} optionDetail={optionDetail}
    wording={{ ...countryWording, noMatch: optionDetail ? "Prueba con otro nombre o con el código" : countryWording.noMatch }}
    leading={(country) => <CountryFlag code={country.code} className={classes.flag} />}
    valueContent={valueContent ?? ((country) => <><CountryFlag code={country.code} className={classes.flag} /><span className={classes.valueText}>{country.name}</span></>)} />;
}

/**
 * What a search compares: no accents, no case, punctuation as spaces, single spaces ("Cañar" = "canar",
 * "+593" = "593", "  santo   domingo " = "santo domingo").
 */
export function searchKey(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * The options a search shows, best first and always in the same order: names that start with what was typed,
 * then names with a word that starts with it, then names that contain it, then other terms (aliases, codes).
 * Ties keep the catalog's order. An empty search shows every option as given.
 */
export function rankOptions<T extends PickerOption>(options: T[], query: string, searchTerms?: (option: T) => string) {
  const needle = searchKey(query);
  if (!needle) return options;
  const ranked: { option: T; rank: number; index: number }[] = [];
  options.forEach((option, index) => {
    const name = searchKey(option.name);
    const rank = name.startsWith(needle) ? 0
      : ` ${name}`.includes(` ${needle}`) ? 1
        : name.includes(needle) ? 2
          : searchKey(`${option.code} ${searchTerms?.(option) ?? ""}`).includes(needle) ? 3 : -1;
    if (rank >= 0) ranked.push({ option, rank, index });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ option }) => option);
}

/** What the trigger may ask of the open list while its search has no focus yet (a sheet still sliding in). */
type ListControl = { chooseActive: () => void; move: (by: number) => void };
/** Keys that reached the trigger before the list existed (its panel mounts with its transition): applied on mount. */
type PendingKeys = { moves: number[]; choose: boolean };

/** A key that types text into a search (a letter, digit, space or sign), not a shortcut or a navigation key. */
const typesText = (event: KeyboardEvent) => event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

/**
 * PLIEGO's choice from a known list: a field-shaped trigger that opens one search field over one list.
 * Desktop anchors a compact panel to the trigger; phones get a bottom sheet with taller rows. The panel's
 * search is the only search chrome; the list is a listbox driven from that field (arrows, Page keys, Enter,
 * Escape), keeps the selected option in view and marks it (ultramar + check). Escape, a choice or a click
 * outside close it and return focus to the trigger. Never a native select.
 * Keyboard first: typing on the focused trigger opens the search with what was typed, its best match active;
 * keys typed before the search takes focus are kept, in order. Only Enter or a click chooses; Escape and Tab
 * close without changing the value.
 */
export function SearchPicker<T extends PickerOption>({
  id,
  label,
  options,
  value,
  onChange,
  wording,
  disabled = false,
  invalid = false,
  describedBy,
  valueContent,
  leading,
  optionDetail,
  searchTerms,
  searchPlaceholder,
  className,
  hideLabel = false,
}: {
  id: string;
  label: string;
  options: T[];
  value: string;
  onChange: (code: string) => void;
  wording: PickerWording;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** What the trigger shows for the selected option (defaults to its name). */
  valueContent?: (option: T) => ReactNode;
  /** Shown before each option's name (e.g. a flag). */
  leading?: (option: T) => ReactNode;
  /** Quiet detail at the end of each option (e.g. the calling code, the canton); `query` is what was typed, trimmed. */
  optionDetail?: (option: T, query: string) => string;
  /** Extra text a search may match (e.g. the calling code). */
  searchTerms?: (option: T) => string;
  searchPlaceholder: string;
  className?: string;
  hideLabel?: boolean;
}) {
  const phone = useMediaQuery("(max-width: 599px)") ?? false;
  const reduceMotion = useReducedMotion();
  const [opened, setOpened] = useState(false);
  // Keyboard opening goes straight to the search; a tap on a phone does not raise the on-screen keyboard.
  const [byKeyboard, setByKeyboard] = useState(false);
  const [sheetReady, setSheetReady] = useState(false);
  // The search belongs to the picker, so keys typed on the trigger reach it before its field has focus.
  const [query, setQuery] = useState("");
  // Each opening is a new list, even one that starts while the last is still fading out: it must take focus again.
  const [openings, setOpenings] = useState(0);
  const listControl = useRef<ListControl | null>(null);
  const pending = useRef<PendingKeys>({ moves: [], choose: false });
  // Arrows used on the trigger since this opening: with a search, they make Enter a deliberate choice.
  const navigated = useRef(false);
  const open = (typed: string) => { pending.current = { moves: [], choose: false }; navigated.current = false; setByKeyboard(true); setQuery(typed); setOpenings((count) => count + 1); setOpened(true); };
  // A new list (another province's cities) starts without the previous search, even if the panel was still closing.
  const [shownOptions, setShownOptions] = useState(options);
  if (shownOptions !== options) { setShownOptions(options); setQuery(""); }
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
  const selected = options.find((option) => option.code === value) ?? null;
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
    // While open, Escape on the trigger belongs to this picker, not to Mantine's window-level Escape around it.
    data-mantine-stop-propagation={opened || undefined}
    className={`country-picker-trigger ${classes.trigger}${className ? ` ${className}` : ""}`}
    onClick={(event) => {
      setByKeyboard(event.detail === 0);
      if (!opened) { setQuery(""); setOpenings((count) => count + 1); pending.current = { moves: [], choose: false }; navigated.current = false; }
      setOpened((isOpen) => !isOpen);
    }}
    onKeyDown={(event) => {
      // A composing keyboard (IME, dead keys) is still building a character: nothing here acts on its keys.
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      // Arrow keys open the list, as on a native select.
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !opened) {
        event.preventDefault(); open("");
      } else if (!opened && typesText(event) && event.key !== " ") {
        // Typing searches at once: the panel opens with the first key already in its field.
        event.preventDefault(); open(event.key);
      } else if (opened && typesText(event) && !(event.key === " " && !query)) {
        // Still on the trigger while the search takes focus: keep every key, in order.
        event.preventDefault(); setQuery((typed) => typed + event.key);
      } else if (opened && event.key === "Backspace") {
        event.preventDefault(); setQuery((typed) => typed.slice(0, -1));
      } else if (opened && event.key === "Escape") {
        // The sheet is still sliding in and its search has no focus yet: Escape closes only this picker.
        event.preventDefault(); event.stopPropagation(); setOpened(false);
      } else if (opened && event.key === "Enter") {
        event.preventDefault();
        if (!searchKey(query) && !navigated.current) setOpened(false);
        // A search or an arrow made the active row a deliberate pick: same as Enter in the search.
        else if (listControl.current) listControl.current.chooseActive(); else pending.current.choose = true;
      } else if (opened && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const by = event.key === "ArrowDown" ? 1 : -1;
        navigated.current = true;
        if (listControl.current) listControl.current.move(by); else pending.current.moves.push(by);
      }
    }}
  >
    <span className={classes.value}>{selected
      ? valueContent?.(selected) ?? <span className={classes.valueText}>{selected.name}</span>
      : <span className={classes.placeholder}>{wording.choose}</span>}</span>
    <MaterialSymbol name="expand_more" className={`country-picker-chevron ${classes.chevron}`} aria-hidden="true" size={20} />
  </button>;

  const list = <OptionList
    key={openings}
    id={id} label={label} options={options} value={value} onChoose={choose} onDismiss={() => setOpened(false)} wording={wording} leading={leading}
    query={query} onQueryChange={setQuery} control={listControl} pending={pending}
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
    {/* The sheet traps focus only once it has slid in (focusing inside it while it is still below the screen
        would scroll the page under it) and lets go as soon as it starts to close, so focus can return to the trigger. */}
    <Drawer.Root
      opened={opened && phone} onClose={() => setOpened(false)} position="bottom" size="min(85dvh, 640px)" trapFocus={false} returnFocus
      transitionProps={{ duration: reduceMotion ? 0 : 220, onEntered: () => setSheetReady(true), onExited: () => setSheetReady(false) }}
      classNames={{ content: classes.sheet, header: classes.sheetHeader, title: classes.sheetTitle, body: classes.sheetBody, close: classes.sheetClose }}
    >
      <Drawer.Overlay />
      <Drawer.Content id={phone ? panelId : undefined} data-country-panel="">
        <FocusTrap active={sheetReady && opened}>
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

function OptionList<T extends PickerOption>({ id, label, options, value, onChoose, onDismiss, wording, leading, optionDetail, searchTerms, placeholder, autoFocus, sheet, query, onQueryChange, control, pending }: {
  id: string;
  label: string;
  options: T[];
  value: string;
  onChoose: (code: string) => void;
  onDismiss: () => void;
  wording: PickerWording;
  leading?: (option: T) => ReactNode;
  optionDetail?: (option: T, query: string) => string;
  searchTerms?: (option: T) => string;
  placeholder: string;
  autoFocus: boolean;
  sheet: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  control: MutableRefObject<ListControl | null>;
  pending: MutableRefObject<PendingKeys>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // The anchored panel focuses its search only once it is placed, without scrolling the page: focusing
  // before positioning would jump to the top and detach the panel from a trigger lower on the page.
  useEffect(() => {
    if (!autoFocus || sheet) return;
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus({ preventScroll: true });
      // What was typed on the trigger is kept; the caret continues after it.
      input?.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const listId = `${id}-listbox`;
  const optionId = (code: string) => `${id}-option-${code}`;
  const visible = useMemo(() => rankOptions(options, query, searchTerms), [options, query, searchTerms]);
  const selectedIndex = visible.findIndex((option) => option.code === value);
  const [active, setActive] = useState(Math.max(0, selectedIndex));
  const activeCountry = visible[Math.min(active, visible.length - 1)];

  // A new search starts on its best match; clearing it returns to the selected option.
  useEffect(() => { setActive(searchKey(query) ? 0 : Math.max(0, selectedIndex)); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  // Open on the selected country, centered, so the current choice is visible without scrolling; then keep
  // the keyboard row in view. Only the list scrolls — never the page behind the panel.
  useEffect(() => {
    if (selectedIndex >= 0) revealOption(listRef.current, optionId(visible[selectedIndex].code), true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (activeCountry) revealOption(listRef.current, optionId(activeCountry.code), false);
  }, [activeCountry?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    control.current = {
      chooseActive: () => { if (activeCountry) onChoose(activeCountry.code); },
      move: (by) => setActive((current) => Math.max(0, Math.min(visible.length - 1, current + by))),
    };
  });
  useEffect(() => () => { control.current = null; }, [control]);
  // Keys typed on the trigger before this list mounted: same result as if they had come a frame later.
  useEffect(() => {
    const { moves, choose } = pending.current;
    pending.current = { moves: [], choose: false };
    if (!moves.length && !choose) return;
    // Each arrow stops at the list's ends, in the order pressed, exactly as on a mounted list (↑ at the top, then ↓).
    const last = visible.length - 1;
    const index = moves.reduce((at, by) => Math.max(0, Math.min(last, at + by)), searchKey(query) ? 0 : Math.max(0, selectedIndex));
    if (choose) { if (visible[index]) onChoose(visible[index].code); } else setActive(index);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter that confirms an IME composition is the keyboard's, never a choice.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
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
        // Escape here closes only this search. Mantine's window-level Escape (the sheet, an address form around the
        // picker) skips events from elements marked like this; React's stopPropagation cannot reach those listeners.
        data-mantine-stop-propagation="true"
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onFocus={(event) => { const end = event.currentTarget.value.length; event.currentTarget.setSelectionRange(end, end); }}
        onKeyDown={onKeyDown}
      />
    </div>
    <div ref={listRef} role="listbox" id={listId} aria-label={label} className={classes.list} hidden={count === 0}>
      {visible.map((option, index) => {
        const isSelected = option.code === value;
        return <div
          key={option.code}
          id={optionId(option.code)}
          role="option"
          aria-selected={isSelected}
          data-active={index === active || undefined}
          className={classes.option}
          onMouseMove={() => { if (index !== active) setActive(index); }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(option.code)}
        >
          {leading?.(option)}
          <span className={classes.optionName}>{option.name}</span>
          {optionDetail && <span className={classes.optionDetail}>{optionDetail(option, query.trim())}</span>}
          <MaterialSymbol name="check" aria-hidden="true" size={18} className={classes.check} />
        </div>;
      })}
    </div>
    {count === 0 && <p className={classes.empty}>No encontramos «{query.trim()}». {wording.noMatch}.</p>}
    <span className="visually-hidden" role="status" aria-live="polite">{query.trim() ? count === 1 ? `1 ${wording.one}` : `${count} ${wording.many}` : ""}</span>
  </div>;
}
