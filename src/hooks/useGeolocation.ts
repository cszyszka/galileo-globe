import { useCallback, useState } from 'react';
import type { Observer } from '../lib/geometry';

// "Use my location": asks the browser for the device position. `error` is a message to show
// when it isn't available or the person declined.
export function useGeolocation(onLocated: (place: Observer) => void) {
  const [error, setError] = useState<string | null>(null);

  const locate = useCallback(() => {
    setError(null);
    if (!navigator.geolocation) {
      setError('Geolocation isn’t available in this browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => onLocated({ lat: coords.latitude, lon: coords.longitude }),
      err => setError(err.message || 'Couldn’t get your location'),
    );
  }, [onLocated]);

  return { locate, error };
}
