// Orbital-element sources, shared by the app and scripts/refresh-data.js.
// Kept free of imports so it can run under plain Node.

export const TLE_SOURCES = {
  galileo: {
    label: 'Galileo',
    url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=galileo&FORMAT=tle',
    file: 'tle-galileo.txt',
  },
  // ESA's Celeste LEO-PNT demonstrators. Querying by name prefix picks up future launches too.
  leopnt: {
    label: 'LEO-PNT (Celeste)',
    url: 'https://celestrak.org/NORAD/elements/gp.php?NAME=LPNTSAT&FORMAT=tle',
    file: 'tle-leopnt.txt',
  },
};
