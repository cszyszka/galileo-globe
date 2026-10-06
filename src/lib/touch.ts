// True on touch-first devices, so hints can say "tap"/"pinch" instead of "click"/"scroll".
export const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
