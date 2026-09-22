// POST /api/verifica — comprova el codi i, només si és correcte, calcula
// l'estimació orientativa d'empelt (PLA.md §«Eina estrella») i retorna el WhatsApp.
// Les UF, el preu i el número no són mai al codi del navegador abans d'aquest pas.
// Secrets: WHATSAPP, BREVO_API_KEY, BREVO_SENDER. Bindings: CODIS (KV), LEADS (D1).

const MAX_INTENTS = 5;

// Unitats foliculares [mín, màx] per patró, amb pelo de grosor medio. Inventades
// per a la demo amb ordres de magnitud del mercat espanyol (2026).
const UF = {
  n2: [900, 1400], n3: [1500, 2100], n3v: [1800, 2500], n4: [2200, 3000], n5: [3000, 3800], n6: [3800, 4800],
  l1: [700, 1100], l2: [1300, 1900], l3: [1900, 2700],
};
const PATRONS = { hombre: ['n2', 'n3', 'n3v', 'n4', 'n5', 'n6'], mujer: ['l1', 'l2', 'l3'] };
const PELO = { fino: 1.1, medio: 1, grueso: 0.9 };
// Tècnica: [factor al mínim, factor al màxim]. «Aconsejadme» obre la forquilla a les dues.
const TECNICA = { fue: [1, 1], dhi: [1.15, 1.15], consejo: [1, 1.15] };
const CUANDO = ['mes', 'trimestre', 'adelante', 'mirando'];
// Preu: mín = (1.500 + 0,9·UFmín)·t · màx = (1.900 + 1,1·UFmàx)·t, arrodonit a centenars.
const PREU = [1500, 0.9, 1900, 1.1];
const LLINDAR_DUES_SESSIONS = 4000;

function json(dades, status = 200) {
  return new Response(JSON.stringify(dades), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const te = (obj, clau) => Object.prototype.hasOwnProperty.call(obj, clau);

// Exportada perquè es pugui provar sense servidor (node) i per calcular els «desde» de les pàgines.
export function calcula(r) {
  const a50 = (x) => Math.round(x / 50) * 50;
  const a100 = (x) => Math.round(x / 100) * 100;
  const ufMin = a50(UF[r.patron][0] * PELO[r.pelo]);
  const ufMax = a50(UF[r.patron][1] * PELO[r.pelo]);
  const t = TECNICA[r.tecnica];
  const min = a100((PREU[0] + PREU[1] * ufMin) * t[0]);
  const max = a100((PREU[2] + PREU[3] * ufMax) * t[1]);
  const sessions = ufMax > LLINDAR_DUES_SESSIONS ? 2 : 1;
  const avisos = [];
  if (r.patron === 'n6' && r.pelo === 'fino') avisos.push('donante');
  if (r.sexo === 'mujer') avisos.push('mujer');
  return { ufMin, ufMax, min, max, sessions, avisos };
}

export function valides(r) {
  return te(PATRONS, r.sexo) && PATRONS[r.sexo].includes(r.patron) && te(PELO, r.pelo) &&
    te(TECNICA, r.tecnica) && CUANDO.includes(r.cuando);
}

export async function onRequestPost({ request, env, waitUntil }) {
  let dades;
  try { dades = await request.json(); } catch { return json({ ok: false, error: 'dades' }, 400); }

  const correu = String(dades.correu || '').trim().toLowerCase();
  const codi = String(dades.codi || '');
  const r = dades.respostes || {};
  if (!correu || !/^\d{6}$/.test(codi)) return json({ ok: false, error: 'codi' }, 400);

  const clau = 'codi:' + (await sha256(correu));
  const desat = await env.CODIS.get(clau, 'json');
  if (!desat || desat.caduca < Date.now()) return json({ ok: false, error: 'caducat' }, 400);
  if (desat.intents >= MAX_INTENTS) {
    await env.CODIS.delete(clau);
    return json({ ok: false, error: 'intents' }, 429);
  }

  if ((await sha256(codi + ':' + correu)) !== desat.hash) {
    desat.intents += 1;
    const queda = Math.max(60, Math.ceil((desat.caduca - Date.now()) / 1000));
    await env.CODIS.put(clau, JSON.stringify(desat), { expirationTtl: queda });
    return json({ ok: false, error: 'codi' }, 400);
  }

  // El servidor refusa qualsevol resposta fora de les llistes, i res es desa sense
  // el consentiment explícit (el patró de caiguda és una dada de salut, art. 9 RGPD).
  if (!valides(r) || dades.consentiment !== true) return json({ ok: false, error: 'respostes' }, 400);

  await env.CODIS.delete(clau); // un codi, una estimació

  const e = calcula(r);
  const idioma = ['es', 'ca', 'en'].includes(dades.idioma) ? dades.idioma : 'es';

  // Contacte per al seguiment (D1). Si la base de dades falla, l'usuari veu igualment l'estimació.
  try {
    await env.LEADS.prepare(
      'INSERT INTO leads (correu, idioma, sexo, patron, pelo, tecnica, cuando, uf_min, uf_max, sessions, minim, maxim) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(correu, idioma, r.sexo, r.patron, r.pelo, r.tecnica, r.cuando, e.ufMin, e.ufMax, e.sessions, e.min, e.max).run();
  } catch (err) {
    console.error('D1 leads:', err && err.message);
  }

  // Avís a la clínica per correu (no bloqueja la resposta).
  const num = (n) => n.toLocaleString('es-ES', { useGrouping: 'always' });
  const avis = [
    'Nuevo contacto desde el estimador de Trazo Clínica',
    '',
    'Correo: ' + correu,
    'Patrón: ' + NOMS.patron[r.patron] + ' (' + r.sexo + ')',
    'Pelo: ' + r.pelo,
    'Técnica: ' + NOMS.tecnica[r.tecnica],
    'Cuándo: ' + NOMS.cuando[r.cuando],
    'Estimación mostrada: ' + num(e.ufMin) + '–' + num(e.ufMax) + ' UF, ' + e.sessions + ' sesión(es), ' + num(e.min) + ' € – ' + num(e.max) + ' €',
    'Idioma de la web: ' + idioma,
  ].join('\n');
  waitUntil(fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Estimador Trazo Clínica', email: env.BREVO_SENDER },
      to: [{ email: env.BREVO_SENDER }],
      replyTo: { email: correu },
      subject: 'Nueva estimación: ' + NOMS.patron[r.patron] + ' · ' + num(e.ufMin) + '–' + num(e.ufMax) + ' UF',
      textContent: avis,
    }),
  }).catch(() => {}));

  // Resum per a l'usuari, en l'idioma de la web (demo: text senzill; una clínica real el treballarà més).
  const t = RESUM[idioma];
  const n = (x) => x.toLocaleString(t.locale, { useGrouping: 'always' });
  const rangUf = n(e.ufMin) + ' – ' + n(e.ufMax);
  const rang = n(e.min) + ' € – ' + n(e.max) + ' €';
  const files = [
    [t.patro, t.patronNoms[r.patron]],
    [t.pelo, t.peloNoms[r.pelo]],
    [t.tecnica, t.tecnicaNoms[r.tecnica]],
    [t.uf, rangUf],
    [t.sessions, e.sessions > 1 ? t.dues : t.una],
  ];
  const notes = e.avisos.map((a) => t.avisos[a]);
  const missatgeWa = encodeURIComponent(t.wa
    .replace('{resum}', files.slice(0, 3).map((f) => f[1]).join(', '))
    .replace('{uf}', rangUf).replace('{rang}', rang));
  const enllacWa = 'https://wa.me/' + String(env.WHATSAPP || '').replace(/\D/g, '') + '?text=' + missatgeWa;
  const html = `<div style="font-family:Arial,sans-serif;color:#211E27;max-width:520px;line-height:1.5">
  <p style="font-size:16px">${t.hola}</p>
  <p style="font-size:14px;color:#57535F;margin:18px 0 4px">${t.estimacio}</p>
  <p style="font-size:30px;font-weight:700;margin:0 0 6px;color:#5B2B84">${rang}</p>
  <p style="font-size:13px;color:#57535F;margin:0 0 18px">${t.nota}</p>
  ${notes.map((x) => `<p style="font-size:14px;border:1px solid #DCD6D1;border-radius:6px;padding:8px 12px;background:#F4EDE8">${x}</p>`).join('')}
  <table style="border-collapse:collapse;width:100%;font-size:15px">${files.map((f) =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #DCD6D1;color:#57535F">${f[0]}</td><td style="padding:8px 0;border-bottom:1px solid #DCD6D1;text-align:right;font-weight:600">${f[1]}</td></tr>`).join('')}</table>
  <p style="margin:24px 0"><a href="${enllacWa}" style="background:#1A7A43;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:700;display:inline-block">${t.botoWa}</a></p>
  <p style="font-size:14px">${t.seguent}</p>
  <p style="font-size:14px;color:#57535F">Trazo Clínica · 600 000 000</p></div>`;
  waitUntil(fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Trazo Clínica', email: env.BREVO_SENDER },
      to: [{ email: correu }],
      subject: t.assumpte + ' · ' + rangUf + ' UF',
      textContent: `${t.hola}\n\n${t.estimacio}: ${rang}\n${t.nota}\n${notes.join('\n')}\n\n${files.map((f) => f[0] + ': ' + f[1]).join('\n')}\n\n${t.botoWa}: ${enllacWa}\n\n${t.seguent}\n\nTrazo Clínica · 600 000 000`,
      htmlContent: html,
    }),
  }).catch(() => {}));

  return json({ ok: true, ...e, whatsapp: env.WHATSAPP });
}

const RESUM = {
  es: {
    locale: 'es-ES',
    assumpte: 'Tu estimación de injerto capilar',
    hola: 'Hola, este es el resumen de la estimación que has calculado en nuestra web.',
    estimacio: 'Precio orientativo',
    nota: 'IVA incluido. El número real de unidades lo decide el médico en la valoración, con tricoscopia de tu zona donante.',
    patro: 'Tu caso', pelo: 'Pelo', tecnica: 'Técnica', uf: 'Unidades foliculares', sessions: 'Sesiones',
    una: '1', dues: '2, separadas unos 12 meses',
    patronNoms: { n2: 'Entradas leves', n3: 'Entradas marcadas', n3v: 'Entradas y coronilla', n4: 'Frente y coronilla', n5: 'Zona superior amplia', n6: 'Solo laterales y nuca', l1: 'Raya algo más ancha', l2: 'Se ve el cuero cabelludo', l3: 'Poca densidad en toda la parte superior' },
    peloNoms: { fino: 'Fino', medio: 'Medio', grueso: 'Grueso' },
    tecnicaNoms: { fue: 'FUE con zafiro', dhi: 'DHI', consejo: 'Que me lo aconsejéis' },
    avisos: {
      donante: 'Puede que tu zona donante no alcance para cubrirlo todo. En la valoración te diremos qué es realista.',
      mujer: 'En mujeres primero descartamos una alopecia difusa o una causa médica: no siempre se opera.',
    },
    botoWa: 'Pedir la valoración por WhatsApp',
    wa: 'Hola, he calculado mi injerto en la web: {resum}. Me salen {uf} unidades foliculares y un precio de {rang}. ¿Cuándo puedo hacer la valoración?',
    seguent: 'Si quieres seguir adelante, responde a este correo o escríbenos por WhatsApp y te damos cita para la valoración gratuita.',
  },
  ca: {
    locale: 'ca-ES',
    assumpte: 'La teva estimació d\'empelt capil·lar',
    hola: 'Hola, aquest és el resum de l\'estimació que has calculat a la nostra web.',
    estimacio: 'Preu orientatiu',
    nota: 'IVA inclòs. El nombre real d\'unitats el decideix el metge a la valoració, amb tricoscòpia de la teva zona donant.',
    patro: 'El teu cas', pelo: 'Cabell', tecnica: 'Tècnica', uf: 'Unitats fol·liculars', sessions: 'Sessions',
    una: '1', dues: '2, separades uns 12 mesos',
    patronNoms: { n2: 'Entrades lleus', n3: 'Entrades marcades', n3v: 'Entrades i coroneta', n4: 'Front i coroneta', n5: 'Zona superior àmplia', n6: 'Només laterals i clatell', l1: 'Clenxa una mica més ampla', l2: 'Es veu el cuir cabellut', l3: 'Poca densitat a tota la part de dalt' },
    peloNoms: { fino: 'Fi', medio: 'Mitjà', grueso: 'Gruixut' },
    tecnicaNoms: { fue: 'FUE amb safir', dhi: 'DHI', consejo: 'Que m\'aconselleu vosaltres' },
    avisos: {
      donante: 'Pot ser que la teva zona donant no n\'hi hagi prou per cobrir-ho tot. A la valoració et direm què és realista.',
      mujer: 'En dones primer descartem una alopècia difusa o una causa mèdica: no sempre s\'opera.',
    },
    botoWa: 'Demanar la valoració per WhatsApp',
    wa: 'Hola, he calculat el meu empelt a la web: {resum}. Em surten {uf} unitats fol·liculars i un preu de {rang}. Quan puc fer la valoració?',
    seguent: 'Si vols tirar endavant, respon aquest correu o escriu-nos per WhatsApp i et donem hora per a la valoració gratuïta.',
  },
  en: {
    locale: 'en-GB',
    assumpte: 'Your hair transplant estimate',
    hola: 'Hi, here is the summary of the estimate you calculated on our website.',
    estimacio: 'Rough price',
    nota: 'VAT included. The doctor sets the real number of grafts at your consultation, after a trichoscopy of your donor area.',
    patro: 'Your case', pelo: 'Hair', tecnica: 'Technique', uf: 'Follicular units', sessions: 'Sessions',
    una: '1', dues: '2, about 12 months apart',
    patronNoms: { n2: 'Slight recession', n3: 'Clear recession', n3v: 'Recession and crown', n4: 'Front and crown', n5: 'Wide top area', n6: 'Only sides and back', l1: 'Slightly wider parting', l2: 'Scalp showing', l3: 'Low density across the top' },
    peloNoms: { fino: 'Fine', medio: 'Medium', grueso: 'Thick' },
    tecnicaNoms: { fue: 'Sapphire FUE', dhi: 'DHI', consejo: 'Advise me' },
    avisos: {
      donante: 'Your donor area may not be enough to cover everything. At the consultation we will tell you what is realistic.',
      mujer: 'In women we first rule out diffuse hair loss or a medical cause: surgery is not always the answer.',
    },
    botoWa: 'Book the consultation on WhatsApp',
    wa: 'Hi, I calculated my hair transplant on your website: {resum}. I get {uf} follicular units and a price of {rang}. When can I have the consultation?',
    seguent: 'If you want to go ahead, reply to this email or message us on WhatsApp and we will book your free consultation.',
  },
};

const NOMS = {
  patron: RESUM.es.patronNoms,
  tecnica: RESUM.es.tecnicaNoms,
  cuando: { mes: 'en el próximo mes', trimestre: 'en 1 a 3 meses', adelante: 'más adelante', mirando: 'solo mirando' },
};

export function onRequest() {
  return json({ ok: false, error: 'metode' }, 405);
}
