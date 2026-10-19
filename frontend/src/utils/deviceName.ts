// Best-effort friendly label for this device/browser, e.g. "Safari on iPhone".
// Used to prefill the passkey name; the user can edit it before saving.
export function detectDeviceName(): string {
  const ua = navigator.userAgent;

  let device: string | null = null;
  if (/iPhone/.test(ua)) device = 'iPhone';
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) device = 'iPad';
  else if (/Android/.test(ua)) {
    const model = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build|[;)])/)?.[1]?.trim();
    device = model && model !== 'K' && !/^Android/.test(model) ? model : 'Android';
  }
  else if (/Windows/.test(ua)) device = 'Windows';
  else if (/Macintosh|Mac OS X/.test(ua)) device = 'Mac';
  else if (/CrOS/.test(ua)) device = 'Chromebook';
  else if (/Linux/.test(ua)) device = 'Linux';

  let browser: string | null = null;
  if (/EdgA?\/|Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  if (browser && device) return `${browser} on ${device}`;
  return device || browser || 'Passkey';
}

export function isMobileDevice(): boolean {
  return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}
