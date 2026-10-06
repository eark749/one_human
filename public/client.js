// One Human client: sends this player's wish, draws the shared body.
(() => {
  const PARTS = ['L_LEG', 'R_LEG', 'L_ARM', 'R_ARM', 'TORSO'];
  const ROLE_INFO = {
    L_LEG: { label: 'Left leg', color: '--leg', back: 'swing back', fwd: 'swing forward' },
    R_LEG: { label: 'Right leg', color: '--leg', back: 'swing back', fwd: 'swing forward' },
    L_ARM: { label: 'Left arm', color: '--arm', back: 'down', fwd: 'up' },
    R_ARM: { label: 'Right arm', color: '--arm', back: 'down', fwd: 'up' },
    TORSO: { label: 'Torso', color: '--torso', back: 'lean back', fwd: 'lean forward' },
    BRAIN: { label: 'Brain', color: '--brain', back: '', fwd: '' },
  };
  const BRAIN_COMMANDS = ['WALK_RIGHT', 'WALK_LEFT', 'STOP', 'LEFT_LEG_NOW', 'RIGHT_LEG_NOW', 'LEAN_FORWARD', 'LEAN_BACK', 'GET_UP', 'SIT'];
  const EMOTES = ['GO', 'STOP', 'LEFT', 'RIGHT', 'WAIT'];
  const nice = (s) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll('_', ' '); // WALK_RIGHT -> Walk right

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
  for (const n of ['--leg', '--arm', '--torso', '--brain', '--head', '--bg', '--surface', '--raised', '--line', '--line-strong', '--text', '--muted', '--faint', '--accent']) colors[n] = css(n);

  const me = { id: null, name: '', role: null, joined: false, axis: 0, up: false, brainCmd: null, life: undefined };
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
        me.life = msg.life; // also recovers if a newlife event was missed during a reconnect
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
      $('myRole').textContent = 'In line';
      $('myRole').style.color = '';
      $('queueUi').textContent = `All spots are taken. You're #${queue} in line and get the next free part.`;
      return;
    }
    const c = colors[info.color];
    $('myRole').textContent = info.label;
    $('myRole').style.color = c;
    $('groupMark').style.background = c;
    $('keyLeft').textContent = `A · ${info.back}`;
    $('keyRight').textContent = `${info.fwd} · D`;
    renderBrainPad();
    const help = role === 'BRAIN' ? 'Only you can see the chair. Tell the body what to do.' : `A or ← to ${info.back}. D or → to ${info.fwd}.`;
    showOverlay(`<span class="eyebrow">Your part</span><h2 style="color:${c}">${info.label}</h2><p>${help}</p>`, 2000);
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
    if (me.role && me.role !== 'BRAIN') send({ t: 'in', axis: me.axis, up: me.up, life: me.life });
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
    if (e.key === ' ') e.preventDefault(); // stop space from also clicking a focused button
    keys.delete(e.key.toLowerCase());
    pushInput();
  });
  // Buttons let go of keyboard focus after a click, so space never re-sends a shout or command.
  addEventListener('pointerup', () => {
    if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
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
      b.innerHTML = `<kbd>${i + 1}</kbd>${nice(cmd)}`;
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
    b.innerHTML = `${nice(e)}<span data-e="${e}"></span>`;
    b.onclick = () => send({ t: 'emote', e });
    emoteBox.appendChild(b);
  });

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
    if (m.queue) extra.push(`${m.queue} in line`);
    if (m.watching) extra.push(`${m.watching} watching`);
    $('extra').textContent = extra.length ? ` · ${extra.join(' · ')}` : '';
    $('rotate').textContent = Math.ceil(m.nextRotateMs / 1000);
    $('life').textContent = m.life;
    $('health').style.width = `${m.health}%`;
    $('health').style.background = m.health > 50 ? 'var(--torso)' : m.health > 20 ? 'var(--arm)' : 'var(--accent)';
    $('timer').textContent = fmt(m.objective.ms);
    $('best').textContent = m.best == null ? '—' : fmt(m.best);

    const hasBrain = !!m.brain.cmd;
    $('order').classList.toggle('none', !hasBrain);
    $('brainCmd').textContent = hasBrain ? nice(m.brain.cmd) : 'No brain yet';
    $('brainVotes').textContent = hasBrain && m.brain.of > 1 ? `${m.brain.votes}/${m.brain.of} brains` : '';

    document.querySelectorAll('[data-e]').forEach((el) => {
      const n = m.emotes[el.dataset.e];
      el.textContent = n ? n : '';
    });
    if (me.role && me.role !== 'BRAIN') $('agree').textContent = `group ${Math.round(m.agreement[me.role] * 100)}% in sync`;

    // Body map: one bar per seat. Bright = a player, dim = idle, empty = free seat, white = you.
    let html = '';
    for (const role of ['BRAIN', 'TORSO', 'L_ARM', 'R_ARM', 'L_LEG', 'R_LEG']) {
      const people = m.roster.filter((r) => r.role === role);
      const info = ROLE_INFO[role];
      let seats = '';
      for (let i = 0; i < m.seats[role]; i++) {
        const p = people[i];
        const cls = !p ? '' : p.id === me.id ? 'me' : p.active ? 'on' : 'idle';
        seats += `<i class="${cls}" title="${p ? esc(p.name) + (p.id === me.id ? ' (you)' : '') : 'free'}"></i>`;
      }
      html += `<div class="row"><div class="head"><span>${info.label}</span><span>${people.length}/${m.seats[role]}</span></div><div class="seats" style="color:${colors[info.color]}">${seats}</div></div>`;
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
      showOverlay(`<span class="eyebrow">Everyone</span><h2>It fell over</h2><p>Hold Space together to stand it back up.</p><div class="upbar"><i style="width:${Math.round(snap.up * 100)}%"></i></div>`);
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
      showOverlay(`<span class="eyebrow">Life ${e.life} · lasted ${fmt(e.ms)}</span><h2>The human died</h2><p>It ${esc(e.cause)}. Life ${e.life + 1} starts in 5 seconds.</p>`, 5000);
    } else if (e.kind === 'sit') {
      showOverlay(`<span class="eyebrow">${e.record ? 'New record' : 'Done'}</span><h2>Sat down in ${fmt(e.ms)}</h2><p>${e.players} ${e.players === 1 ? 'person' : 'people'} did this together.</p>`, 3000);
    } else if (e.kind === 'hit') {
      toast(`Ouch · health ${e.health}%`);
    } else if (e.kind === 'getup') {
      toast('Back on its feet');
    } else if (e.kind === 'newlife') {
      // New subject: drop held keys so it starts from rest. Players press again.
      me.life = e.life;
      keys.clear();
      held.clear();
      document.querySelectorAll('.held').forEach((b) => b.classList.remove('held'));
      pushInput();
      toast(`Life ${e.life} begins`);
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
    ctx.fillStyle = colors['--bg'];
    ctx.fillRect(0, 0, W, H);
    if (!b) return;

    const isBrain = me.role === 'BRAIN';
    const wide = isBrain || !me.role;
    // The brain and people watching see the whole room. Body players see a close-up.
    // Keep the floor above the control panel so the feet are always visible.
    const dock = $('dock');
    const dockTop = dock.hidden ? H : dock.getBoundingClientRect().top;
    const groundY = Math.min(H * 0.78, dockTop - 32);
    const topSpace = W < 760 ? 120 : 80;
    const viewUp = wide ? 2.8 : 2.2; // meters visible above the floor
    const viewAcross = wide ? 7 : 3.4; // meters visible across
    const scale = Math.max(40, Math.min((groundY - topSpace) / viewUp, W / viewAcross));
    const pelvisX = b[2 * 3];
    const focusX = wide ? (pelvisX + chairX) / 2 : pelvisX;
    camX = lerp(camX, focusX, 0.08);
    const sx = (x) => W / 2 + (x - camX) * scale;
    const sy = (y) => groundY - y * scale;
    const left = camX - W / 2 / scale, right = camX + W / 2 / scale;

    // floor: one hairline, a soft fade below, and quiet meter marks
    const fade = ctx.createLinearGradient(0, sy(0), 0, H);
    fade.addColorStop(0, 'rgba(255, 255, 255, 0.035)');
    fade.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, sy(0), W, H - sy(0));
    ctx.strokeStyle = colors['--line-strong'];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(sy(0)) + 0.5);
    ctx.lineTo(W, Math.round(sy(0)) + 0.5);
    ctx.stroke();
    ctx.fillStyle = colors['--faint'];
    ctx.font = '400 10px "Geist Mono", monospace';
    for (let x = Math.floor(left); x <= right; x++) {
      ctx.fillRect(Math.round(sx(x)), sy(0) + 1, 1, 5);
      ctx.fillText(`${x}m`, sx(x) + 4, sy(0) + 14);
    }

    // start line: where every life and every attempt begins (x = 0)
    const startX = Math.round(sx(0)) + 0.5;
    ctx.strokeStyle = colors['--line-strong'];
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(startX, sy(0));
    ctx.lineTo(startX, sy(2.05));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colors['--text'];
    ctx.fillRect(startX - 6, Math.round(sy(0)) - 1, 12, 2); // a solid mark on the floor
    ctx.font = '500 11px "Geist Mono", monospace';
    ctx.fillStyle = colors['--muted'];
    ctx.textAlign = 'center';
    ctx.fillText('START', startX, sy(2.05) - 8);
    ctx.textAlign = 'start';

    // goal: only the brain sees it
    if (isBrain) {
      ctx.strokeStyle = colors['--accent'];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx(chairX), sy(0), 0.42 * scale, 0.06 * scale, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = colors['--brain'];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx(pelvisX), sy(1.3));
      ctx.quadraticCurveTo(sx((pelvisX + chairX) / 2), sy(2.1), sx(chairX), sy(0.9));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // chair — must match ragdoll.ts buildWorld
    ctx.fillStyle = colors['--line-strong'];
    const rect = (cx, cy, hx, hy) => {
      ctx.beginPath();
      ctx.roundRect(sx(cx - hx), sy(cy + hy), hx * 2 * scale, hy * 2 * scale, 2);
      ctx.fill();
    };
    rect(chairX, 0.46, 0.25, 0.04);
    rect(chairX + 0.25, 0.9, 0.03, 0.4);
    rect(chairX - 0.22, 0.21, 0.02, 0.21);
    rect(chairX + 0.22, 0.21, 0.02, 0.21);

    // soft shadow under the body
    const shadow = ctx.createRadialGradient(sx(pelvisX), sy(0), 0, sx(pelvisX), sy(0), 0.5 * scale);
    shadow.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(sx(pelvisX), sy(0) + 2, 0.5 * scale, 0.06 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // body: flat shapes in each part's color; the far side is dimmer; your part gets a white ring
    for (const i of DRAW_ORDER) {
      const [name, size, color, side] = BODIES[i];
      const x = b[i * 3], y = b[i * 3 + 1], a = b[i * 3 + 2];
      const mine = OWNER[name] === me.role;
      const empty = meta && OWNER[name] && !meta.roster.some((r) => r.role === OWNER[name]);
      ctx.save();
      ctx.translate(sx(x), sy(y));
      ctx.rotate(-a);
      // your own part is always drawn at full strength, even when it is on the far side
      ctx.globalAlpha = mine ? 1 : (side === 'L' ? 0.45 : 1) * (empty ? 0.35 : 1);
      ctx.fillStyle = colors[color];
      if (size.r) {
        // head: a crash-test marker, white with two dark quarters
        const r = size.r * scale;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colors['--bg'];
        for (const start of [0, Math.PI]) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, r * 0.82, start, start + Math.PI / 2);
          ctx.fill();
        }
      } else {
        const w = size.hx * 2 * scale, h = size.hy * 2 * scale;
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) / 2);
        ctx.fill();
        if (mine) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = colors['--text'];
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // what people are shouting: small pills above the head
    if (meta) {
      const shouts = Object.entries(meta.emotes).sort((a, b) => b[1] - a[1]).slice(0, 3);
      ctx.font = '500 12px "Geist", system-ui, sans-serif';
      ctx.textAlign = 'center';
      shouts.forEach(([e, n], k) => {
        const text = `${nice(e)} ${n}`;
        const w = ctx.measureText(text).width + 20;
        const x = sx(b[0]) + (k - (shouts.length - 1) / 2) * 84, y = sy(b[1]) - 0.28 * scale - 14;
        ctx.globalAlpha = k === 0 ? 1 : 0.7;
        ctx.fillStyle = colors['--surface'];
        ctx.strokeStyle = colors['--line-strong'];
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - 13, w, 24, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = colors['--text'];
        ctx.fillText(text, x, y + 3);
      });
      ctx.globalAlpha = 1;
      ctx.textAlign = 'start';
    }
  }

  connect();
  requestAnimationFrame(frame);
})();
