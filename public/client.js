// One Human client: sends this player's wish, draws the shared body.
(() => {
  const PARTS = ['L_LEG', 'R_LEG', 'L_ARM', 'R_ARM', 'TORSO'];
  const ROLE_INFO = {
    L_LEG: { label: 'LEFT LEG', color: '--leg', back: 'swing back', fwd: 'swing forward' },
    R_LEG: { label: 'RIGHT LEG', color: '--leg', back: 'swing back', fwd: 'swing forward' },
    L_ARM: { label: 'LEFT ARM', color: '--arm', back: 'down', fwd: 'up' },
    R_ARM: { label: 'RIGHT ARM', color: '--arm', back: 'down', fwd: 'up' },
    TORSO: { label: 'TORSO', color: '--torso', back: 'lean back', fwd: 'lean forward' },
    BRAIN: { label: 'BRAIN', color: '--brain', back: '', fwd: '' },
  };
  const BRAIN_COMMANDS = ['WALK_RIGHT', 'WALK_LEFT', 'STOP', 'LEFT_LEG_NOW', 'RIGHT_LEG_NOW', 'LEAN_FORWARD', 'LEAN_BACK', 'GET_UP', 'SIT'];
  const EMOTES = ['GO', 'STOP', 'LEFT', 'RIGHT', 'WAIT'];

  // Must match server/src/ragdoll.ts BODY_NAMES order and sizes.
  const BODIES = [
    ['head', { r: 0.12 }, '--head', 'C'],
    ['torso', { hx: 0.13, hy: 0.27 }, '--torso', 'C'],
    ['pelvis', { hx: 0.15, hy: 0.08 }, '--torso', 'C'],
    ['uArmL', { hx: 0.04, hy: 0.15 }, '--arm', 'L'],
    ['lArmL', { hx: 0.035, hy: 0.14 }, '--arm', 'L'],
    ['uArmR', { hx: 0.04, hy: 0.15 }, '--arm', 'R'],
    ['lArmR', { hx: 0.035, hy: 0.14 }, '--arm', 'R'],
    ['thighL', { hx: 0.06, hy: 0.2 }, '--leg', 'L'],
    ['shinL', { hx: 0.05, hy: 0.2 }, '--leg', 'L'],
    ['footL', { hx: 0.1, hy: 0.04 }, '--leg', 'L'],
    ['thighR', { hx: 0.06, hy: 0.2 }, '--leg', 'R'],
    ['shinR', { hx: 0.05, hy: 0.2 }, '--leg', 'R'],
    ['footR', { hx: 0.1, hy: 0.04 }, '--leg', 'R'],
  ];
  const OWNER = { uArmL: 'L_ARM', lArmL: 'L_ARM', uArmR: 'R_ARM', lArmR: 'R_ARM', thighL: 'L_LEG', shinL: 'L_LEG', footL: 'L_LEG', thighR: 'R_LEG', shinR: 'R_LEG', footR: 'R_LEG', torso: 'TORSO', pelvis: 'TORSO' };
  // Draw the far side first so the near side sits on top.
  const DRAW_ORDER = [3, 4, 7, 8, 9, 2, 1, 0, 10, 11, 12, 5, 6];

  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const colors = {};
  for (const n of ['--leg', '--arm', '--torso', '--brain', '--head', '--hazard', '--hazard-ink', '--ink', '--muted', '--dim', '--line', '--wall', '--tile', '--floor', '--panel']) colors[n] = css(n);

  const me = { id: null, name: '', role: null, joined: false, axis: 0, up: false, brainCmd: null };
  let chairX = 5;
  let meta = null;
  let roster = [];
  const snaps = []; // { at, b, agg, up, f }

  // ---------------- network ----------------
  let ws;
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onmessage = (ev) => handle(JSON.parse(ev.data));
    ws.onclose = () => {
      if (me.joined) $('myRole').textContent = 'Reconnecting…';
      setTimeout(connect, 1500);
    };
  }
  const send = (msg) => ws && ws.readyState === 1 && ws.send(JSON.stringify(msg));

  function handle(msg) {
    switch (msg.t) {
      case 'hello':
        chairX = msg.chairX ?? chairX;
        // After a reconnect, take a seat again without showing the landing card.
        if (me.joined) send({ t: 'join' });
        break;
      case 'welcome':
        me.id = msg.id;
        me.name = msg.name;
        me.joined = true;
        chairX = msg.chairX ?? chairX;
        $('landing').hidden = true;
        $('dock').hidden = false;
        setRole(msg.role, msg.queue);
        break;
      case 'role':
        setRole(msg.role);
        break;
      case 'snap':
        snaps.push({ at: performance.now(), b: msg.b, agg: msg.agg, up: msg.up, f: msg.f });
        if (snaps.length > 30) snaps.shift();
        updateGroupBar(msg);
        updateFallOverlay(msg);
        break;
      case 'meta': {
        // The player list only arrives when it changes; keep the last one.
        if (msg.roster) roster = msg.roster;
        const idle = new Set(msg.idle || []);
        msg.roster = roster.map((r) => ({ ...r, active: !idle.has(r.id) }));
        meta = msg;
        renderMeta();
        break;
      }
      case 'event':
        onEvent(msg);
        break;
    }
  }

  function setRole(role, queue) {
    me.role = role;
    me.axis = 0;
    me.brainCmd = null;
    $('myName').textContent = me.name;
    const info = ROLE_INFO[role];
    $('limbUi').hidden = !role || role === 'BRAIN';
    $('brainUi').hidden = role !== 'BRAIN';
    $('queueUi').hidden = !!role;
    if (!role) {
      $('myRole').textContent = 'STANDBY';
      $('myRole').style.color = '';
      $('queueUi').textContent = `Every operator station is taken. You are #${queue} on standby and get the next free station.`;
      return;
    }
    const c = colors[info.color];
    $('myRole').textContent = info.label;
    $('myRole').style.color = c;
    $('groupMark').style.background = c;
    $('groupKey').style.color = c;
    $('keyLeft').textContent = `◀ A · ${info.back}`;
    $('keyRight').textContent = `${info.fwd} · D ▶`;
    renderBrainPad();
    const help = role === 'BRAIN' ? 'Control room. You see the seat. Nobody else does. Issue directives.' : `A / ◀ ${info.back} · D / ▶ ${info.fwd}`;
    showOverlay(`<div class="label">Assignment</div><h2 style="color:${c}">${info.label}</h2><p>${help}</p>`, 2200);
  }

  // ---------------- input ----------------
  const keys = new Set();
  const held = new Set();
  function computeAxis() {
    let a = 0;
    if (keys.has('a') || keys.has('arrowleft') || held.has(-1)) a -= 1;
    if (keys.has('d') || keys.has('arrowright') || held.has(1)) a += 1;
    return a;
  }
  function pushInput() {
    me.axis = computeAxis();
    me.up = keys.has(' ') || held.has('up');
    $('myMark').style.left = `${50 + me.axis * 50}%`;
    if (me.role && me.role !== 'BRAIN') send({ t: 'in', axis: me.axis, up: me.up });
  }
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (me.role === 'BRAIN' && /^[1-9]$/.test(k)) {
      chooseBrain(BRAIN_COMMANDS[Number(k) - 1]);
      return;
    }
    if (['a', 'd', 'arrowleft', 'arrowright', ' '].includes(k)) {
      e.preventDefault();
      if (!keys.has(k)) {
        keys.add(k);
        pushInput();
      }
    }
  });
  addEventListener('keyup', (e) => {
    keys.delete(e.key.toLowerCase());
    pushInput();
  });
  addEventListener('blur', () => {
    keys.clear();
    held.clear();
    pushInput();
  });
  document.querySelectorAll('[data-hold], [data-up]').forEach((btn) => {
    const token = btn.hasAttribute('data-up') ? 'up' : Number(btn.dataset.hold);
    const on = (e) => { e.preventDefault(); held.add(token); btn.classList.add('held'); pushInput(); };
    const off = () => { held.delete(token); btn.classList.remove('held'); pushInput(); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('pointercancel', off);
  });
  // Heartbeat: the server treats silence as "let go".
  setInterval(pushInput, 250);

  function renderBrainPad() {
    const pad = $('brainpad');
    pad.innerHTML = '';
    BRAIN_COMMANDS.forEach((cmd, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${i + 1} ${cmd.replaceAll('_', ' ')}`;
      b.className = me.brainCmd === cmd ? 'on' : '';
      b.onclick = () => chooseBrain(cmd);
      pad.appendChild(b);
    });
  }
  function chooseBrain(cmd) {
    me.brainCmd = cmd;
    send({ t: 'brain', cmd });
    renderBrainPad();
  }
  // Keep a held brain command alive (server forgets brains silent for 10 s).
  setInterval(() => me.role === 'BRAIN' && me.brainCmd && send({ t: 'brain', cmd: me.brainCmd }), 3000);

  const emoteBox = $('emotes');
  EMOTES.forEach((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `${e}<span data-e="${e}"></span>`;
    b.onclick = () => send({ t: 'emote', e });
    emoteBox.appendChild(b);
  });

  $('seatToggle').onclick = () => $('seatmap').classList.toggle('open');
  $('join').onclick = () => send({ t: 'join' });

  // ---------------- HUD ----------------
  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function renderMeta() {
    const m = meta;
    $('players').textContent = m.players;
    $('landingCount').textContent = m.players;
    const extra = [];
    if (m.queue) extra.push(`${m.queue} on standby`);
    if (m.watching) extra.push(`${m.watching} observing`);
    $('extra').textContent = extra.join(' · ');
    $('rotate').textContent = Math.ceil(m.nextRotateMs / 1000);
    $('life').textContent = m.life;
    $('health').style.width = `${m.health}%`;
    $('health').style.background = m.health > 50 ? 'var(--torso)' : m.health > 20 ? 'var(--arm)' : 'var(--hazard)';
    $('timer').textContent = fmt(m.objective.ms);
    $('best').textContent = m.best == null ? '—' : fmt(m.best);

    const hasBrain = !!m.brain.cmd;
    $('order').classList.toggle('none', !hasBrain);
    $('brainCmd').textContent = hasBrain ? m.brain.cmd.replaceAll('_', ' ') : 'NO DIRECTIVE';
    $('brainVotes').textContent = hasBrain ? `directive · ${m.brain.votes} of ${m.brain.of} brains agree` : 'the control room is empty';

    document.querySelectorAll('[data-e]').forEach((el) => {
      const n = m.emotes[el.dataset.e];
      el.textContent = n ? ` ×${n}` : '';
    });
    if (me.role && me.role !== 'BRAIN') $('agree').textContent = `${Math.round(m.agreement[me.role] * 100)}% agree`;

    // Body map: one dot per seat. Filled = a person, hollow = empty seat.
    let html = '<div class="label">Operator stations</div>';
    for (const role of ['BRAIN', 'TORSO', 'L_ARM', 'R_ARM', 'L_LEG', 'R_LEG']) {
      const people = m.roster.filter((r) => r.role === role);
      const info = ROLE_INFO[role];
      let dots = '';
      for (let i = 0; i < m.seats[role]; i++) {
        const p = people[i];
        const cls = !p ? '' : `taken${p.active ? '' : ' idle'}${p.id === me.id ? ' me' : ''}`;
        dots += `<i class="${cls}" title="${p ? esc(p.name) + (p.id === me.id ? ' (you)' : '') : 'empty seat'}"></i>`;
      }
      const loose = people.length ? '' : `<span class="loose">${role === 'BRAIN' ? 'empty' : 'unmanned'}</span>`;
      html += `<div class="seatrow"><div class="head"><span style="color:${colors[info.color]}">${info.label}</span>${loose || `<span class="help">${people.length}/${m.seats[role]}</span>`}</div><div class="dots" style="color:${colors[info.color]}">${dots}</div></div>`;
    }
    $('seatmap').innerHTML = html;
  }

  function updateGroupBar(snap) {
    const i = PARTS.indexOf(me.role);
    if (i >= 0) $('groupMark').style.left = `${50 + snap.agg[i] * 50}%`;
  }

  // ---------------- overlays ----------------
  let overlayTimer = null;
  let fallShown = false;
  function showOverlay(html, ms) {
    $('overlayCard').innerHTML = html;
    $('overlay').hidden = false;
    clearTimeout(overlayTimer);
    if (ms) overlayTimer = setTimeout(() => ($('overlay').hidden = true), ms);
  }
  function updateFallOverlay(snap) {
    if (snap.f) {
      fallShown = true;
      showOverlay(`<div class="label">All operators</div><h2>Subject down</h2><p>Hold SPACE (or GET UP) together to stand the subject up.</p><div class="upbar"><i style="width:${Math.round(snap.up * 100)}%"></i></div>`);
    } else if (fallShown) {
      fallShown = false;
      $('overlay').hidden = true;
    }
  }
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(t._h);
    t._h = setTimeout(() => (t.hidden = true), 2500);
  }
  function onEvent(e) {
    if (e.kind === 'death') {
      showOverlay(`<div class="label">Subject #${e.life} · survived ${fmt(e.ms)}</div><h2>Subject lost</h2><p>The internet killed the human. Cause: ${esc(e.cause)}. Subject #${e.life + 1} enters the chamber in 5 seconds.</p>`, 5000);
    } else if (e.kind === 'sit') {
      showOverlay(`<div class="label">${e.record ? 'New lab record' : 'Trial complete'}</div><h2>Seated in ${fmt(e.ms)}</h2><p>${e.players} ${e.players === 1 ? 'operator' : 'operators'} did this together.</p>`, 3000);
    } else if (e.kind === 'hit') {
      toast(`Impact detected · integrity ${e.health}%`);
    } else if (e.kind === 'getup') {
      toast('Subject is back on its feet');
    } else if (e.kind === 'newlife') {
      toast(`Subject #${e.life} enters the chamber`);
    }
  }

  // ---------------- rendering ----------------
  const canvas = $('c');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = innerWidth;
    H = innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }
  addEventListener('resize', resize);
  resize();

  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

  // Draw 100 ms in the past and blend the two snapshots around that moment.
  function sample() {
    if (!snaps.length) return null;
    const renderAt = performance.now() - 100;
    for (let i = snaps.length - 1; i > 0; i--) {
      const a = snaps[i - 1], b = snaps[i];
      if (a.at <= renderAt && renderAt <= b.at) {
        const t = (renderAt - a.at) / (b.at - a.at || 1);
        return a.b.map((v, k) => (k % 3 === 2 ? lerpAngle(v, b.b[k], t) : lerp(v, b.b[k], t)));
      }
    }
    return snaps[snaps.length - 1].b;
  }

  let camX = 0;
  function frame() {
    requestAnimationFrame(frame);
    const b = sample();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors['--wall'];
    ctx.fillRect(0, 0, W, H);
    if (!b) return;

    const isBrain = me.role === 'BRAIN';
    const wide = isBrain || !me.role;
    // Brains and observers see the whole chamber. Body operators see a close-up.
    // Keep the floor above the control panel so the feet are always visible.
    const dock = $('dock');
    const dockTop = dock.hidden ? H : dock.getBoundingClientRect().top;
    const groundY = Math.min(H * 0.8, dockTop - 28);
    const topSpace = W < 760 ? 130 : 90;
    // meters visible above the floor, and across the screen
    const viewUp = wide ? 2.8 : 2.2;
    const viewAcross = wide ? 7 : 3.4;
    const scale = Math.max(40, Math.min((groundY - topSpace) / viewUp, W / viewAcross));
    const pelvisX = b[2 * 3];
    const focusX = wide ? (pelvisX + chairX) / 2 : pelvisX;
    camX = lerp(camX, focusX, 0.08);
    const sx = (x) => W / 2 + (x - camX) * scale;
    const sy = (y) => groundY - y * scale;
    const left = camX - W / 2 / scale, right = camX + W / 2 / scale;

    // wall tiles, 0.5 m
    ctx.strokeStyle = colors['--tile'];
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(left * 2) / 2; x <= right; x += 0.5) { ctx.moveTo(sx(x), 0); ctx.lineTo(sx(x), sy(0)); }
    for (let y = 0.5; sy(y) > 0; y += 0.5) { ctx.moveTo(0, sy(y)); ctx.lineTo(W, sy(y)); }
    ctx.stroke();

    // stencil signs on the wall
    ctx.font = `800 ${Math.round(0.34 * scale)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    ctx.fillStyle = 'rgba(21, 25, 28, 0.13)';
    ctx.fillText('CHAMBER A', sx(1.6), sy(1.9));
    ctx.font = `700 ${Math.round(0.16 * scale)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    ctx.fillStyle = 'rgba(21, 25, 28, 0.35)';
    ctx.fillText('TEST SEAT ▼', sx(chairX - 0.3), sy(1.55));
    ctx.fillText('START', sx(-0.2), sy(1.95));

    // floor with a hazard stripe along the edge
    ctx.fillStyle = colors['--floor'];
    ctx.fillRect(0, sy(0), W, H - sy(0));
    const band = Math.max(6, 0.06 * scale);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, sy(0), W, band);
    ctx.clip();
    ctx.fillStyle = colors['--hazard'];
    ctx.fillRect(0, sy(0), W, band);
    ctx.fillStyle = colors['--hazard-ink'];
    const off = ((sx(0) % 24) + 24) % 24;
    for (let x = -24 + off; x < W + 24; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, sy(0) + band);
      ctx.lineTo(x + 12, sy(0) + band);
      ctx.lineTo(x + 12 + band, sy(0));
      ctx.lineTo(x + band, sy(0));
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = colors['--ink'];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, sy(0));
    ctx.lineTo(W, sy(0));
    ctx.stroke();

    // distance markers on the floor
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.fillStyle = colors['--muted'];
    for (let x = Math.floor(left); x <= right; x++) {
      ctx.fillRect(sx(x), sy(0) + band, 1.5, 8);
      ctx.fillText(`${x}m`, sx(x) + 4, sy(0) + band + 14);
    }
    // start line
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = colors['--dim'];
    ctx.beginPath();
    ctx.moveTo(sx(0), sy(0));
    ctx.lineTo(sx(0), sy(1.85));
    ctx.stroke();
    ctx.setLineDash([]);

    // goal marker: only the brain sees it
    if (isBrain) {
      ctx.strokeStyle = colors['--hazard'];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(sx(chairX), sy(0), 0.45 * scale, 0.07 * scale, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([8, 7]);
      ctx.strokeStyle = colors['--brain'];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx(pelvisX), sy(1.3));
      ctx.quadraticCurveTo(sx((pelvisX + chairX) / 2), sy(2.1), sx(chairX), sy(0.9));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // test seat (seat, back, legs) — must match ragdoll.ts buildWorld
    ctx.fillStyle = '#3C464D';
    const rect = (cx, cy, hx, hy) => ctx.fillRect(sx(cx - hx), sy(cy + hy), hx * 2 * scale, hy * 2 * scale);
    rect(chairX, 0.46, 0.25, 0.04);
    rect(chairX + 0.25, 0.9, 0.03, 0.4);
    rect(chairX - 0.22, 0.21, 0.02, 0.21);
    rect(chairX + 0.22, 0.21, 0.02, 0.21);
    ctx.fillStyle = colors['--hazard'];
    rect(chairX, 0.505, 0.25, 0.012);

    // body
    for (const i of DRAW_ORDER) {
      const [name, size, color, side] = BODIES[i];
      const x = b[i * 3], y = b[i * 3 + 1], a = b[i * 3 + 2];
      const mine = OWNER[name] === me.role;
      const loose = meta && OWNER[name] && !meta.roster.some((r) => r.role === OWNER[name]);
      ctx.save();
      ctx.translate(sx(x), sy(y));
      ctx.rotate(-a);
      ctx.globalAlpha = (side === 'L' ? 0.5 : 1) * (loose ? 0.35 : 1);
      ctx.fillStyle = colors[color];
      ctx.strokeStyle = mine ? colors['--hazard'] : colors['--ink'];
      ctx.lineWidth = mine ? 3.5 : 1.5;
      if (size.r) {
        // crash-test dummy head: yellow with two black quarters
        const r = size.r * scale;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colors['--ink'];
        for (const start of [0, Math.PI]) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, r, start, start + Math.PI / 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const w = size.hx * 2 * scale, h = size.hy * 2 * scale;
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.45);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    // what the crowd is shouting, above the head
    if (meta) {
      const shouts = Object.entries(meta.emotes).sort((a, b) => b[1] - a[1]).slice(0, 3);
      ctx.font = '600 13px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      shouts.forEach(([e, n], k) => {
        const text = `${e} ×${n}`;
        const x = sx(b[0]) + (k - (shouts.length - 1) / 2) * 92, y = sy(b[1]) - 0.3 * scale - 10;
        const w = ctx.measureText(text).width + 16;
        ctx.fillStyle = k === 0 ? colors['--ink'] : colors['--panel'];
        ctx.strokeStyle = colors['--ink'];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(x - w / 2, y - 16, w, 24);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = k === 0 ? colors['--hazard'] : colors['--ink'];
        ctx.fillText(text, x, y + 1);
      });
      ctx.textAlign = 'start';
    }
    // brain glow on the head for brain players
    if (isBrain) {
      ctx.strokeStyle = colors['--brain'];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sx(b[0]), sy(b[1]), 0.17 * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  connect();
  requestAnimationFrame(frame);
})();
