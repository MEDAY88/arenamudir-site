const SUPABASE_URL = 'https://gfdmvrcrnlfrwbmxepey.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmZG12cmNybmxmcndibXhlcGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MDY0ODUsImV4cCI6MjA5MTE4MjQ4NX0.aKR9pYUWKfb_VU0O36bI8SHR6-4DxVMPTdBGzyYpF24';

let sb, user = null, license = null, tunnelUrl = '', liveTimers = {};

function initSupabase() {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function show(id) {
  ['loginScreen','expiredScreen'].forEach(s => {
    document.getElementById(s).className = s === id ? 'screen active' : 'screen';
  });
  const p = document.getElementById('portal');
  p.className = id === 'portal' ? 'portal active' : 'portal';
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value;
  const err = document.getElementById('loginError');
  const btn = document.getElementById('btnLogin');
  if (!email || !pass) { err.textContent = 'Remplissez tous les champs'; return; }
  btn.disabled = true; btn.textContent = 'Connexion...'; err.textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) {
    err.textContent = 'Email ou mot de passe incorrect';
    btn.disabled = false; btn.textContent = 'Se connecter';
    return;
  }
  user = data.user;
  await initPortal();
}

async function doLogout() {
  await sb.auth.signOut();
  user = null; license = null;
  Object.values(liveTimers).forEach(t => clearInterval(t));
  liveTimers = {};
  show('loginScreen');
  document.getElementById('btnLogin').disabled = false;
  document.getElementById('btnLogin').textContent = 'Se connecter';
}

async function initPortal() {
  const { data, error } = await sb.from('licenses').select('*').eq('user_id', user.id).single();
  let lic = data;
  if (error || !lic) {
    const { data: fb } = await sb.from('licenses').select('*').eq('active', true).limit(1).single();
    if (!fb) {
      document.getElementById('loginError').textContent = 'Aucune licence trouvée.';
      await sb.auth.signOut();
      show('loginScreen');
      return;
    }
    lic = fb;
  }
  license = lic;
  if (!license.active || (license.expires_at && new Date(license.expires_at) < new Date())) {
    show('expiredScreen');
    return;
  }
  show('portal');
  // Small delay to ensure DOM is ready
  await new Promise(r => setTimeout(r, 50));
  updateUI();
  tunnelUrl = localStorage.getItem('am_tunnel') || license.tunnel_url || '';
  await checkOnline();
  await loadOverview();
}

function g(id) { return document.getElementById(id); }

function updateUI() {
  if (!license) return;
  const plan = license.plan || 'local';
  const name = license.lounge_name || 'Mon Lounge';
  if (g('topbarLounge')) g('topbarLounge').textContent = name;
  if (g('planBadge')) { g('planBadge').textContent = plan === 'remote' ? '🌐 Remote' : '🖥️ Local'; g('planBadge').className = 'plan-badge ' + plan; }
  if (g('tab-live')) g('tab-live').style.display = plan === 'remote' ? 'block' : 'none';
  if (g('subPlan')) g('subPlan').textContent = plan === 'remote' ? 'Remote — $35/mois' : 'Local — $20/mois';
  if (g('subLounge')) g('subLounge').textContent = name;
  if (g('subExpiry')) g('subExpiry').textContent = license.expires_at ? new Date(license.expires_at).toLocaleDateString('fr-FR') : '—';
  if (g('subStations')) g('subStations').textContent = (license.standard_stations||8) + ' std' + (license.vip_stations ? ' + '+license.vip_stations+' VIP' : '');
  if (g('subDevice')) g('subDevice').textContent = license.device_id || '—';
  if (g('subLastSeen')) g('subLastSeen').textContent = license.last_seen_at ? new Date(license.last_seen_at).toLocaleString('fr-FR') : 'Jamais';
}

async function checkOnline() {
  const pill = document.getElementById('loungePill');
  const dot = document.getElementById('loungeDot');
  const text = document.getElementById('loungeStatusText');
  if (!tunnelUrl) {
    pill.className = 'lounge-pill unknown'; dot.className = 'dot unknown'; text.textContent = 'Non configuré';
    return;
  }
  try {
    const r = await fetch(tunnelUrl + '/ping', { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    if (d.status === 'ok') {
      pill.className = 'lounge-pill online'; dot.className = 'dot online'; text.textContent = 'En ligne';
    }
  } catch(e) {
    pill.className = 'lounge-pill offline'; dot.className = 'dot offline'; text.textContent = 'Hors ligne';
  }
}

async function loadOverview() {
  if (!tunnelUrl) { showErr('overviewError', 'URL tunnel non configurée'); return; }
  clearErr('overviewError');
  try {
    const [rRep, rHist] = await Promise.all([
      fetch(tunnelUrl + '/reports', { signal: AbortSignal.timeout(8000) }),
      fetch(tunnelUrl + '/history', { signal: AbortSignal.timeout(8000) })
    ]);
    if (!rRep.ok || !rHist.ok) throw new Error('HTTP error');
    const rep = await rRep.json();
    const hist = await rHist.json();
    document.getElementById('revToday').textContent = (rep.today?.revenue||0).toFixed(2);
    document.getElementById('sessToday').textContent = rep.today?.sessions||0;
    document.getElementById('revWeek').textContent = (rep.week?.revenue||0).toFixed(2);
    document.getElementById('sessWeek').textContent = rep.week?.sessions||0;
    const ranking = rep.ranking||[];
    const maxR = ranking[0]?.[1]||1;
    document.getElementById('rankingList').innerHTML = ranking.length === 0
      ? empty('📊','Aucune donnée cette semaine')
      : ranking.slice(0,8).map(([n,r],i) => `<div class="ranking-row"><div class="r-pos">#${i+1}</div><div class="r-name">${n}</div><div class="r-bar-wrap"><div class="r-bar" style="width:${Math.round(r/maxR*100)}%"></div></div><div class="r-amount">${r.toFixed(2)}</div></div>`).join('');
    document.getElementById('todayList').innerHTML = hist.length === 0
      ? empty('📋', "Aucune session aujourd'hui")
      : hist.map(h => `<div class="history-item"><div class="h-station">${h.station}</div><div class="h-time">${h.startTime}→${h.endTime||'--'}</div><div style="font-size:12px;color:var(--text2);">${h.billedMin||'?'}min</div><div class="h-price">${(h.finalPrice||0).toFixed(2)}</div></div>`).join('');
  } catch(e) {
    showErr('overviewError', 'Lounge hors ligne ou URL incorrecte');
    document.getElementById('rankingList').innerHTML = empty('⚠️','Données non disponibles');
    document.getElementById('todayList').innerHTML = '';
  }
}

async function fetchLive() {
  clearErr('liveError');
  if (!tunnelUrl) { document.getElementById('tunnelManual').style.display = 'block'; return; }
  const dot = document.getElementById('liveDot');
  const txt = document.getElementById('liveStatusText');
  try {
    const r = await fetch(tunnelUrl + '/live', { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const sessions = await r.json();
    document.getElementById('tunnelManual').style.display = 'none';
    dot.className = 'live-dot on';
    txt.textContent = 'Connecté · ' + sessions.length + ' session(s)';
    Object.values(liveTimers).forEach(t => clearInterval(t));
    liveTimers = {};
    if (sessions.length === 0) { document.getElementById('liveGrid').innerHTML = empty('😴', 'Aucune session active'); return; }
    // Build cards with normalized timestamps
    const sessionData = sessions.map(s => {
      const startMs = (s.startedAtEpochMs < 1e12) ? s.startedAtEpochMs * 1000 : s.startedAtEpochMs;
      const isFree = s.durationSec === -1;
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      const rem = isFree ? elapsed : Math.max(0, s.durationSec - elapsed);
      return { ...s, startMs, isFree, rem };
    });

    document.getElementById('liveGrid').innerHTML = sessionData.map(s =>
      `<div class="station-card active"><div class="s-name">📺 ${s.stationName}</div><div class="s-timer" id="lt-${s.sessionId}">${fmt(s.rem)}</div><div class="s-label">${s.isFree ? '⬆ Libre' : '⬇ Restant'}</div><div style="font-size:10px;color:var(--text2);margin-top:4px;">${s.players||1}J · ${(s.price||0).toFixed(2)} TND</div></div>`
    ).join('');

    sessionData.forEach(s => {
      const el2 = document.getElementById('lt-' + s.sessionId);
      if (!el2) return;
      liveTimers[s.sessionId] = setInterval(() => {
        const elapsed = Math.floor((Date.now() - s.startMs) / 1000);
        el2.textContent = fmt(s.isFree ? elapsed : Math.max(0, s.durationSec - elapsed));
      }, 1000);
    });
  } catch(e) {
    dot.className = 'live-dot off';
    txt.textContent = 'Lounge hors ligne';
    document.getElementById('tunnelManual').style.display = 'block';
    document.getElementById('liveGrid').innerHTML = empty('🔌','Impossible de se connecter');
    showErr('liveError', 'Lounge hors ligne ou URL tunnel incorrecte');
  }
}

async function loadHistory() {
  clearErr('historyError');
  if (!tunnelUrl) { showErr('historyError', 'URL tunnel non configurée'); return; }
  try {
    const r = await fetch(tunnelUrl + '/history', { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP error');
    const hist = await r.json();
    document.getElementById('historyList').innerHTML = hist.length === 0
      ? empty('📋', "Aucune session dans les 7 derniers jours")
      : hist.map(h => `<div class="history-item"><div class="h-station">${h.station}</div><div class="h-time">${h.date||''} ${h.startTime||''}→${h.endTime||'--'}</div><div style="font-size:12px;color:var(--text2);">${h.billedMin||'?'} min · ${h.players||1}J</div><div class="h-price">${(h.finalPrice||0).toFixed(2)} TND</div></div>`).join('');
  } catch(e) {
    showErr('historyError', 'Impossible de charger l\'historique');
    document.getElementById('historyList').innerHTML = empty('⚠️','Données non disponibles');
  }
}

function switchTab(name) {
  const names = ['overview','live','history','subscription'];
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', names[i] === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (name === 'live') fetchLive();
  if (name === 'history') loadHistory();
  if (name === 'overview') loadOverview();
}

function fmt(s) { if(s<0)s=0; return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); }
function empty(icon, msg) { return `<div class="empty"><div class="empty-icon">${icon}</div><p>${msg}</p></div>`; }
function showErr(id, msg) { const el=document.getElementById(id); if(el) el.innerHTML=`<div class="error-bar">⚠️ ${msg}</div>`; }
function clearErr(id) { const el=document.getElementById(id); if(el) el.innerHTML=''; }

document.addEventListener('DOMContentLoaded', async () => {
  initSupabase();

  document.getElementById('btnLogin').addEventListener('click', doLogin);
  document.getElementById('loginEmail').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  document.getElementById('loginPassword').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });

  const bl = document.getElementById('btnLogout');
  if (bl) bl.addEventListener('click', doLogout);
  const ble = document.getElementById('btnLogoutExpired');
  if (ble) ble.addEventListener('click', doLogout);
  const br = document.getElementById('btnRefresh');
  if (br) br.addEventListener('click', fetchLive);

  // Email buttons (avoid Cloudflare obfuscation)
  const mail = 'contact' + '@' + 'arenamudir.com';
  const btnRenew = document.getElementById('btnRenew');
  if (btnRenew) btnRenew.addEventListener('click', () => window.location = 'mailto:' + mail + '?subject=Renouvellement');
  const btnContact = document.getElementById('btnContact');
  if (btnContact) btnContact.addEventListener('click', () => window.location = 'mailto:' + mail + '?subject=Renouvellement ArenaMudir');

  ['tab-overview','tab-live','tab-history','tab-subscription'].forEach((id, i) => {
    const names = ['overview','live','history','subscription'];
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => switchTab(names[i]));
  });

  const { data: { session } } = await sb.auth.getSession();
  if (session) { user = session.user; await initPortal(); }
});
