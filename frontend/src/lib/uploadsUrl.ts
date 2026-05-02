/**
 * Construye URL autenticada para recursos de /uploads/*.
 *
 * Por qué: el middleware uploadsAuthMiddleware (Fix #6 IDOR de la
 * auditoría de seguridad) requiere JWT válido en cada request. Las
 * etiquetas <img src="/uploads/..."> y <a href="/uploads/...">
 * no envían el header Authorization, por lo que el backend
 * devuelve 401. El middleware acepta también `?token=<jwt>` por
 * query param exactamente para este caso.
 *
 * Uso:
 *   <img src={withAuthToken(foto.url)} />
 *   window.open(withAuthToken(url), '_blank')
 *
 * Si la URL ya tiene token o no es de /uploads/, se devuelve sin tocar.
 */
export function withAuthToken(url: string | null | undefined): string {
  if (!url) return '';
  // Solo añadir token a URLs de uploads (relativas o absolutas locales)
  const esUpload = url.startsWith('/uploads/') || url.includes('/uploads/');
  if (!esUpload) return url;
  // Ya tiene token
  if (url.includes('?token=') || url.includes('&token=')) return url;

  const token = localStorage.getItem('loga_token') || sessionStorage.getItem('loga_token') || '';
  if (!token) return url; // sin token, devolver tal cual (fallará pero al menos no rompe el render)

  const separador = url.includes('?') ? '&' : '?';
  return `${url}${separador}token=${encodeURIComponent(token)}`;
}
