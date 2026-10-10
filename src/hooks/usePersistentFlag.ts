import { useCallback, useState } from 'react';
import { readFlag, writeFlag } from '../lib/storage';

// A boolean preference that is remembered in the browser between visits.
export function usePersistentFlag(key: string, fallback: boolean): [boolean, (on: boolean) => void] {
  const [value, setValue] = useState(() => readFlag(key, fallback));
  const set = useCallback((on: boolean) => {
    setValue(on);
    writeFlag(key, on);
  }, [key]);
  return [value, set];
}
