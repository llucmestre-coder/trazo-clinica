// GET /admin — llista dels contactes de l'estimador (protegida per _middleware.js).

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euros = (n) => (Number(n) || 0).toLocaleString('es-ES', { useGrouping: 'always' }) + ' €';

export async function onRequestGet({ env }) {
  const { results } = await env.LEADS.prepare(
    'SELECT id, creat, correu, idioma, sexo, patron, pelo, tecnica, cuando, uf_min, uf_max, sessions, minim, maxim, estat FROM leads ORDER BY id DESC LIMIT 500'
  ).all();

  const files = results.map((l) => `<tr>
    <td>${esc(l.creat)}</td><td><a href="mailto:${esc(l.correu)}">${esc(l.correu)}</a></td>
    <td>${esc(l.sexo)}</td><td>${esc(l.patron)}</td><td>${esc(l.pelo)}</td><td>${esc(l.tecnica)}</td>
    <td>${esc(l.cuando)}</td><td>${esc(l.uf_min)}–${esc(l.uf_max)} UF · ${esc(l.sessions)} ses.</td><td>${euros(l.minim)} – ${euros(l.maxim)}</td><td>${esc(l.idioma)}</td></tr>`).join('');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Contactos · Trazo Clínica</title>
<style>
  body{margin:0;padding:1.5rem;font:15px/1.45 system-ui,sans-serif;background:#FAF9F7;color:#211E27}
  h1{font-size:1.4rem;margin:0 0 .25rem} p{margin:0 0 1rem;color:#57535F}
  a{color:#5B2B84} .taula{overflow-x:auto;background:#fff;border-radius:6px}
  table{border-collapse:collapse;width:100%;min-width:900px} th,td{padding:.55rem .7rem;text-align:left;border-bottom:1px solid #DCD6D1;white-space:nowrap}
  th{font-weight:600;background:#DCD6D1}
</style></head><body>
<h1>Contactos del estimador</h1>
<p>${results.length} registros (máximo 500 en pantalla) · <a href="/admin/leads.csv">Descargar CSV</a></p>
<div class="taula"><table><thead><tr><th>Fecha (UTC)</th><th>Correo</th><th>Sexo</th><th>Patrón</th><th>Pelo</th><th>Técnica</th><th>Cuándo</th><th>Unidades</th><th>Estimación</th><th>Idioma</th></tr></thead>
<tbody>${files || '<tr><td colspan="10">Todavía no hay contactos.</td></tr>'}</tbody></table></div>
</body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
