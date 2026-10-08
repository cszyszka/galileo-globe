// Apply the saved appearance before first paint so there is no flash of the wrong theme.
// Loaded as a plain blocking script from both pages; kept out of the HTML so the
// Content-Security-Policy needs no inline scripts.
try {
  var t = localStorage.getItem('gg-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
