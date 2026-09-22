/* =========================================================================
   TRAZO CLÍNICA — estimador d'empelts (PLA.md §«Eina estrella»)
   Adaptat de la calculadora de referència de la skill web-demo.
   - Una pregunta per pantalla; en tocar una opció avança sola.
   - Les UF, el preu i el WhatsApp NO són al client: els retorna /api/verifica
     després de validar el codi que /api/codi envia al correu.
   - Textos escrits des del JS: sempre passen per I18N.t amb la frase dins.
   ========================================================================= */
(function () {
  'use strict';

  if (!window.I18N) window.I18N = { t: function (s) { return s; } };
  var arrel = document.getElementById('calc');
  if (!arrel) return;

  /* Clau pública del widget Turnstile «trazo-clinica estimador» (trazo-clinica.pages.dev
     i localhost). La secreta és un secret de Pages. */
  var TURNSTILE_SITEKEY = '0x4AAAAAAE_pv-9Z5wo-SxWM';

  var PREGUNTES = ['sexo', 'patron', 'pelo', 'tecnica', 'cuando'];
  var PASSOS = PREGUNTES.concat(['correu', 'codi', 'resultat']);
  var DESAT = 'trazo-estimador';
  var PATRONS = { hombre: ['n2', 'n3', 'n3v', 'n4', 'n5', 'n6'], mujer: ['l1', 'l2', 'l3'] };
  var redueix = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var $ = function (sel, dins) { return (dins || arrel).querySelector(sel); };
  var $$ = function (sel, dins) { return Array.prototype.slice.call((dins || arrel).querySelectorAll(sel)); };

  var estat = llegeix() || { pas: 0, respostes: {}, correu: '', resultat: null };

  /* Només es recupera on s'havia quedat si es recarrega la pàgina. Arribant-hi
     des de qualsevol botó o enllaç, l'estimador comença de zero. */
  function llegeix() {
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (!nav || nav.type !== 'reload') {
      try { sessionStorage.removeItem(DESAT); } catch (e) { /* res */ }
      return null;
    }
    try { return JSON.parse(sessionStorage.getItem(DESAT)); } catch (e) { return null; }
  }
  function desa() {
    try { sessionStorage.setItem(DESAT, JSON.stringify(estat)); } catch (e) { /* sense emmagatzematge: continua igual */ }
  }

  /* Accessos directes de la home: estimador.html?patron=n3 (salta 1 i 2)
     o estimador.html?sexo=mujer (salta la 1). */
  var params = new URLSearchParams(location.search);
  var patroUrl = params.get('patron');
  var sexeUrl = params.get('sexo');
  if (!estat.respostes.sexo) {
    if (patroUrl && /^(n2|n3|n3v|n4|n5|n6|l1|l2|l3)$/.test(patroUrl)) {
      estat.respostes.sexo = { valor: patroUrl.charAt(0) === 'n' ? 'hombre' : 'mujer' };
      estat.respostes.patron = { valor: patroUrl };
      estat.pas = 2;
    } else if (sexeUrl && /^(hombre|mujer)$/.test(sexeUrl)) {
      estat.respostes.sexo = { valor: sexeUrl };
      estat.pas = 1;
    }
  }

  /* ── Pintar un pas ─────────────────────────────────────────────────── */
  function pantalla(nom) { return $('.calc-pas[data-pas="' + nom + '"]'); }

  function mostra(index, enrere) {
    index = Math.max(0, Math.min(index, PASSOS.length - 1));
    if (PASSOS[index] === 'resultat' && !estat.resultat) index = PASSOS.indexOf('correu');
    for (var i = 0; i < PREGUNTES.length && i < index; i++) {
      if (!estat.respostes[PREGUNTES[i]]) { index = i; break; }
    }
    estat.pas = index;
    desa();

    var nom = PASSOS[index];
    $$('.calc-pas').forEach(function (s) { s.hidden = s.getAttribute('data-pas') !== nom; });
    var actual = pantalla(nom);
    actual.classList.remove('entra', 'entra-enrere');
    if (!redueix) { void actual.offsetWidth; actual.classList.add(enrere ? 'entra-enrere' : 'entra'); }

    if (nom === 'patron') preparaPatrons();
    marcaEscollides(actual);

    var fetes = Math.min(index, PREGUNTES.length);
    $('.calc-progres i').style.transform = 'scaleX(' + (fetes / PREGUNTES.length) + ')';
    $('.calc-progres').setAttribute('aria-valuenow', String(fetes));
    $('[data-calc-num]').textContent = String(Math.min(index + 1, PREGUNTES.length));
    $('.calc-comptador').hidden = index >= PREGUNTES.length;
    $('[data-calc-enrere]').hidden = index === 0 || nom === 'resultat';
    $('.calc-cap').hidden = nom === 'resultat';
    $('[data-calc-resum]').hidden = nom === 'resultat';

    pintaResum();
    if (nom === 'correu') preparaCaptcha();
    if (nom === 'codi') { $('[data-calc-correu]').textContent = estat.correu; $('.calc-codi input').focus(); }
    if (nom === 'resultat') pintaResultat();

    var titol = actual.querySelector('[tabindex="-1"]');
    if (titol && nom !== 'codi') titol.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: redueix ? 'auto' : 'smooth' });
  }

  /* Al pas 2 només es veuen els dibuixos de l'escala que toca. */
  function preparaPatrons() {
    var sexe = estat.respostes.sexo.valor;
    $$('[data-grup]', pantalla('patron')).forEach(function (g) { g.hidden = g.getAttribute('data-grup') !== sexe; });
  }

  function etiqueta(pregunta) {
    var r = estat.respostes[pregunta];
    if (!r) return '';
    var op = pantalla(pregunta).querySelector('.calc-op[data-valor="' + r.valor + '"] .calc-op-nom');
    return op ? op.textContent.trim() : r.valor;
  }

  function marcaEscollides(seccio) {
    var pregunta = seccio.getAttribute('data-pas');
    var r = estat.respostes[pregunta];
    $$('.calc-op', seccio).forEach(function (b) {
      b.setAttribute('aria-pressed', r && b.getAttribute('data-valor') === r.valor ? 'true' : 'false');
    });
  }

  function pintaResum() {
    var llista = $('[data-calc-resum]');
    llista.innerHTML = '';
    PREGUNTES.forEach(function (p, i) {
      if (!estat.respostes[p] || i >= estat.pas) return;
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = etiqueta(p);
      b.setAttribute('aria-label', I18N.t('Cambiar esta respuesta') + ': ' + etiqueta(p));
      b.addEventListener('click', function () { mostra(i, true); });
      li.appendChild(b);
      llista.appendChild(li);
    });
  }

  /* ── Respondre: un clic i avança ───────────────────────────────────── */
  PREGUNTES.forEach(function (pregunta, i) {
    pantalla(pregunta).addEventListener('click', function (e) {
      var b = e.target.closest('.calc-op');
      if (!b) return;
      estat.respostes[pregunta] = { valor: b.getAttribute('data-valor') };
      // Canviar el sexe invalida el patró si és de l'altra escala.
      if (pregunta === 'sexo' && estat.respostes.patron &&
          PATRONS[estat.respostes.sexo.valor].indexOf(estat.respostes.patron.valor) < 0) {
        delete estat.respostes.patron;
      }
      estat.resultat = null;
      marcaEscollides(pantalla(pregunta));
      setTimeout(function () { mostra(i + 1); }, redueix ? 0 : 220);
    });
  });

  /* Teclat: 1–6 trien opció a les preguntes (només les visibles). */
  document.addEventListener('keydown', function (e) {
    if (e.target.closest('input, textarea, select')) return;
    var nom = PASSOS[estat.pas];
    if (PREGUNTES.indexOf(nom) < 0 || !/^[1-6]$/.test(e.key)) return;
    var visibles = $$('.calc-op', pantalla(nom)).filter(function (b) { return !b.closest('[hidden]'); });
    var b = visibles[Number(e.key) - 1];
    if (b) b.click();
  });

  $('[data-calc-enrere]').addEventListener('click', function () { mostra(estat.pas - 1, true); });

  /* ── Correu + captcha ──────────────────────────────────────────────── */
  var widget = null;
  function preparaCaptcha() {
    if (widget !== null) return;
    var render = function () {
      if (!window.turnstile || widget !== null) return;
      widget = window.turnstile.render('#calc-turnstile', {
        sitekey: TURNSTILE_SITEKEY,
        language: document.documentElement.lang || 'es',
        appearance: 'interaction-only'
      });
    };
    if (window.turnstile) return render();
    window.trazoTurnstile = render;
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=trazoTurnstile';
    s.async = true;
    document.head.appendChild(s);
  }

  function error(seccio, text) {
    $('[data-calc-error]', pantalla(seccio)).textContent = text || '';
  }

  function envia(url, dades) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(dades)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; j.ok = r.ok && j.ok !== false; return j; });
    });
  }

  function respostesPerEnviar() {
    var out = {};
    PREGUNTES.forEach(function (p) { out[p] = estat.respostes[p].valor; });
    return out;
  }

  var formCorreu = $('[data-calc-form-correu]');
  formCorreu.addEventListener('submit', function (e) {
    e.preventDefault();
    var camp = formCorreu.elements.email;
    var correu = camp.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correu)) {
      camp.setAttribute('aria-invalid', 'true');
      camp.focus();
      return error('correu', I18N.t('Escribe un correo válido, por ejemplo nombre@gmail.com.'));
    }
    camp.setAttribute('aria-invalid', 'false');
    var permis = formCorreu.elements.consentimiento;
    if (!permis.checked) {
      permis.focus();
      return error('correu', I18N.t('Marca la casilla para que podamos guardar tus respuestas y enseñarte la estimación.'));
    }
    var token = window.turnstile && widget !== null ? window.turnstile.getResponse(widget) : '';
    if (!token) return error('correu', I18N.t('Espera un momento a que termine la comprobación de seguridad y vuelve a pulsar.'));

    var boto = formCorreu.querySelector('button[type="submit"]');
    var text = boto.textContent;
    boto.disabled = true;
    boto.textContent = I18N.t('Enviando…');
    error('correu', '');
    envia('/api/codi', { correu: correu, token: token, idioma: document.documentElement.lang || 'es' })
      .then(function (j) {
        if (j.ok) {
          estat.correu = correu;
          mostra(PASSOS.indexOf('codi'));
          compteEnrere();
        } else if (j.status === 429) {
          error('correu', I18N.t('Has pedido demasiados códigos. Espera unos minutos y vuelve a intentarlo.'));
        } else if (j.error === 'captcha') {
          error('correu', I18N.t('No hemos podido confirmar que no eres un robot. Vuelve a intentarlo.'));
        } else {
          error('correu', I18N.t('No hemos podido enviar el código. Inténtalo de nuevo en unos minutos.'));
        }
      })
      .catch(function () { error('correu', I18N.t('No hemos podido enviar el código. Inténtalo de nuevo en unos minutos.')); })
      .finally(function () {
        boto.disabled = false;
        boto.textContent = text;
        if (window.turnstile && widget !== null) window.turnstile.reset(widget);
      });
  });

  /* ── Codi de 6 xifres ─────────────────────────────────────────────── */
  var caselles = $$('.calc-codi input');
  function codi() { return caselles.map(function (c) { return c.value; }).join(''); }
  function omple(xifres) {
    xifres = xifres.replace(/\D/g, '').slice(0, 6);
    caselles.forEach(function (c, i) { c.value = xifres[i] || ''; });
    var seguent = caselles[Math.min(xifres.length, 5)];
    if (seguent) seguent.focus();
    if (xifres.length === 6) verifica();
  }
  caselles.forEach(function (c, i) {
    c.addEventListener('input', function () {
      if (c.value.length > 1) return omple(c.value);  // enganxat o autocompletat del mòbil
      c.value = c.value.replace(/\D/g, '');
      if (c.value && caselles[i + 1]) caselles[i + 1].focus();
      if (codi().length === 6) verifica();
    });
    c.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && !c.value && caselles[i - 1]) caselles[i - 1].focus();
    });
    c.addEventListener('paste', function (e) {
      e.preventDefault();
      omple((e.clipboardData || window.clipboardData).getData('text'));
    });
  });

  var verificant = false;
  function verifica() {
    if (verificant) return;
    verificant = true;
    error('codi', '');
    envia('/api/verifica', { correu: estat.correu, codi: codi(), respostes: respostesPerEnviar(), consentiment: formCorreu.elements.consentimiento.checked, idioma: document.documentElement.lang || 'es' })
      .then(function (j) {
        if (j.ok && typeof j.min === 'number' && typeof j.max === 'number' && typeof j.ufMin === 'number') {
          estat.resultat = {
            min: j.min, max: j.max, ufMin: j.ufMin, ufMax: j.ufMax, sessions: j.sessions || 1,
            avisos: Array.isArray(j.avisos) ? j.avisos : [],
            wa: String(j.whatsapp || '').replace(/\D/g, '')
          };
          mostra(PASSOS.indexOf('resultat'));
        } else {
          omple('');
          if (j.error === 'caducat') error('codi', I18N.t('El código ha caducado. Pide uno nuevo.'));
          else if (j.status === 429) error('codi', I18N.t('Demasiados intentos. Pide un código nuevo.'));
          else error('codi', I18N.t('El código no es correcto. Revísalo y vuelve a escribirlo.'));
        }
      })
      .catch(function () { error('codi', I18N.t('No hemos podido comprobar el código. Inténtalo de nuevo.')); })
      .finally(function () { verificant = false; });
  }

  var reenvia = $('[data-calc-reenvia]');
  var rellotge = null;
  function compteEnrere() {
    var s = 30;
    reenvia.disabled = true;
    clearInterval(rellotge);
    rellotge = setInterval(function () {
      s--;
      if (s <= 0) { clearInterval(rellotge); reenvia.disabled = false; }
    }, 1000);
  }
  reenvia.addEventListener('click', function () { mostra(PASSOS.indexOf('correu'), true); });
  $('[data-calc-canvia-correu]').addEventListener('click', function () { mostra(PASSOS.indexOf('correu'), true); });

  /* ── Resultat i WhatsApp ───────────────────────────────────────────── */
  function xifra(n) {
    return n.toLocaleString((window.I18N && window.I18N.bcp) || 'es-ES', { maximumFractionDigits: 0, useGrouping: 'always' });
  }
  function euros(n) { return xifra(n) + ' €'; }

  var AVISOS = {
    donante: 'Puede que tu zona donante no alcance para cubrirlo todo. En la valoración te diremos qué es realista.',
    mujer: 'En mujeres primero descartamos una alopecia difusa o una causa médica: no siempre se opera.'
  };

  function pintaResultat() {
    var r = estat.resultat;
    var rangUf = xifra(r.ufMin) + ' – ' + xifra(r.ufMax);
    var rang = euros(r.min) + ' – ' + euros(r.max);
    $('[data-calc-uf]').textContent = rangUf;
    $('[data-calc-preu]').textContent = rang;
    $('[data-calc-sessions]').textContent = r.sessions > 1
      ? I18N.t('En 2 sesiones, separadas unos 12 meses')
      : I18N.t('En 1 sesión');

    var avisos = $('[data-calc-avisos]');
    avisos.innerHTML = '';
    r.avisos.forEach(function (clau) {
      if (!AVISOS[clau]) return;
      var p = document.createElement('p');
      p.className = 'avis';
      p.textContent = I18N.t(AVISOS[clau]);
      avisos.appendChild(p);
    });

    var llista = $('[data-calc-resultat-resum]');
    llista.innerHTML = '';
    var resum = PREGUNTES.map(function (p) { return etiqueta(p); });
    resum.forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = t;
      llista.appendChild(li);
    });

    var missatge = I18N.t('Hola, he calculado mi injerto en la web: {resumen}. Me salen {uf} unidades foliculares y un precio de {rango}. ¿Cuándo puedo hacer la valoración?')
      .replace('{resumen}', resum.join(', '))
      .replace('{uf}', rangUf)
      .replace('{rango}', rang);
    var wa = $('[data-calc-wa]');
    wa.hidden = !r.wa;
    wa.href = 'https://wa.me/' + r.wa + '?text=' + encodeURIComponent(missatge);
  }

  $('[data-calc-reinicia]').addEventListener('click', function () {
    estat = { pas: 0, respostes: {}, correu: estat.correu, resultat: null };
    mostra(0, true);
  });

  /* Canvi d'idioma sense recarregar: repinta el que surt del JS. */
  document.addEventListener('idioma-canviat', function () {
    pintaResum();
    if (PASSOS[estat.pas] === 'resultat' && estat.resultat) pintaResultat();
  });

  mostra(estat.pas);
})();
