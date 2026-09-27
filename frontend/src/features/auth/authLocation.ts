export function authLocation(pathname: string, from: string) {
  return { pathname, search: new URLSearchParams({ from }).toString() };
}
