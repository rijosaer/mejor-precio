const AGENTE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export class Bloqueo extends Error {}

// `tambienOk`: estados que la tienda usa aunque la respuesta traiga datos válidos
// (la búsqueda de Éxito responde 406 con el JSON completo).
// 8 s por tienda: en Netlify la función entera tiene 10 s para responder.
export async function pedir(url, { encabezados = {}, tiempo = 8000, como = 'json', tambienOk = [] } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': AGENTE, 'accept-language': 'es-CO,es;q=0.9', ...encabezados },
    signal: AbortSignal.timeout(tiempo),
    redirect: 'follow',
  });
  if (res.status === 403 || res.status === 429) throw new Bloqueo(`HTTP ${res.status}`);
  if (!res.ok && !tambienOk.includes(res.status)) throw new Error(`HTTP ${res.status}`);
  const texto = await res.text();
  if (como === 'texto') return texto;
  try {
    return JSON.parse(texto);
  } catch {
    // Una página HTML en lugar de JSON suele ser la verificación anti-robots.
    if (/<html/i.test(texto)) throw new Bloqueo('La tienda respondió con una página de verificación');
    throw new Error('Respuesta no válida');
  }
}
