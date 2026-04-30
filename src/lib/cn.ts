// Tiny className concatenator. Tailwind's class ordering matters when two
// utilities target the same property (e.g. `px-2 px-4` — last wins), so cn()
// preserves order. We use clsx because it handles falsy values + arrays
// without forcing every callsite to do `condition && 'foo'` ternaries.
//
// Not using tailwind-merge here — its bundle weight (~7kB gz) and runtime
// cost aren't justified for a codebase where component authors control
// the class strings. If a real conflict bites us later, we add tailwind-merge
// then.
export { clsx as cn } from 'clsx'
