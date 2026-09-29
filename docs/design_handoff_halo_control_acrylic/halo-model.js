// Shared mock bridge + view model for the Halo 2 Control direction studies.
(function () {
  const MODES = { front: '前燈', back: '後燈', both: '前後燈' };
  const SRC = { app: '本 App', remote: '原廠控制器', web: '橋接器網頁', restored: '開機還原' };
  const SCENARIOS = [
    ['first', '首次使用'], ['searching', '搜尋中'], ['noresults', '搜尋無結果'], ['connecting', '連線中'],
    ['ready', '已連線且就緒'], ['executing', '命令處理中'], ['transmitted', '已送出'], ['failed', '發送失敗'],
    ['unknown', '結果不明'], ['reconnect', '斷線後自動恢復'], ['boot', '橋接器重新開機'],
  ];
  const BASE = { power: true, mode: 'both', front: 60, back: 35, temp: 4000 };
  const PRESETS = [
    { id: 'p1', name: '閱讀', mode: 'both', front: 70, back: 30, temp: 4300 },
    { id: 'p2', name: '夜晚', mode: 'back', front: 20, back: 25, temp: 2900 },
    { id: 'p3', name: '專注', mode: 'front', front: 85, back: 40, temp: 5200 },
  ];
  const FOUND = [
    { name: 'screenbar-halo2', host: '192.168.1.42', port: 8080 },
    { name: 'screenbar-halo2-study', host: '192.168.1.57', port: 8080 },
  ];
  const GROUPS = { INVALID_HOST: '需要修正輸入', INVALID_CREDENTIALS: '需要修正輸入', UNAUTHORIZED: '需要修正輸入', INVALID_VALUE: '需要修正輸入', NETWORK: '連線問題', NOT_CONNECTED: '連線問題', DISCOVERY_UNAVAILABLE: '連線問題', BOOT_CHANGED: '裝置狀態改變', DEVICE_CHANGED: '裝置狀態改變', RATE_LIMITED: '稍後再試', BUSY: '稍後再試', RADIO_UNAVAILABLE: '稍後再試', EXPERIMENTAL_DISABLED: '功能限制', UNSUPPORTED_FIELD: '功能限制', PROTOCOL_ERROR: '功能限制', UNKNOWN_OUTCOME: '需要特別處理' };
  const SLIDERS = [
    { key: 'front', label: '前燈', min: 1, max: 100, step: 1, unit: '%' },
    { key: 'back', label: '後燈', min: 1, max: 100, step: 1, unit: '%' },
    { key: 'temp', label: '色溫', min: 2700, max: 6500, step: 25, unit: ' K' },
  ];
  const EVENTS = [
    { time: '21:14:03', title: '套用燈光設定', status: '已送出', kind: 'ok', code: '', tx: 'TX 12/12 · IRQ 2E · FIFO 0' },
    { time: '21:12:41', title: '原廠控制器：開燈', status: '已接收', kind: 'idle', code: '', tx: '' },
    { time: '21:10:18', title: '關燈', status: '結果不明', kind: 'warn', code: 'UNKNOWN_OUTCOME', tx: 'TX 7/12 · IRQ 20 · FIFO 3' },
    { time: '21:09:55', title: '連線橋接器', status: '成功', kind: 'ok', code: '', tx: '' },
    { time: '20:58:02', title: '關燈', status: '發送失敗', kind: 'err', code: 'RADIO_UNAVAILABLE', tx: 'TX 0/12 · IRQ — · FIFO —' },
  ];
  const fmt = (v) => `${MODES[v.mode]} · 前 ${v.front}% · 後 ${v.back}% · ${v.temp} K`;
  const clock = () => new Date().toLocaleTimeString('zh-TW', { hour12: false });
  function tempColor(k) {
    const t = Math.max(0, Math.min(1, (k - 2700) / 3800));
    const a = [255, 196, 102], b = [224, 236, 255];
    return '#' + a.map((c, i) => Math.round(c + (b[i] - c) * t).toString(16).padStart(2, '0')).join('');
  }
  function seed(s) {
    const b = { phase: 'connected', online: true, radioReady: true, desired: { ...BASE }, source: 'remote', draft: {}, experimental: true, cmd: null, banner: null,
      remote: { power: true, mode: 'both', front: 60, back: 35, temp: 4000, ago: 12 }, presets: PRESETS, presetsOpen: false, presetName: '', presetMsg: '',
      panel: false, tab: 'device', diagLoaded: false, diagMsg: '', showRaw: false, cleared: false, lastSync: '21:14:08', saved: { host: '192.168.1.42', port: 8080 }, settingsMsg: '',
      host: '192.168.1.42', port: 8080, user: 'admin', pass: '', remember: true, searching: false, results: null, picked: null, searchMsg: '', searchKind: '', connecting: false };
    const setup = { ...b, phase: 'setup', saved: null, online: false, remember: false, host: 'screenbar-halo2.local', user: '' };
    switch (s) {
      case 'first': return setup;
      case 'searching': return { ...setup, searching: true };
      case 'noresults': return { ...setup, results: [], searchKind: 'empty', searchMsg: '找不到橋接器，可直接輸入 IP。' };
      case 'connecting': return { ...setup, results: FOUND, picked: 0, host: '192.168.1.42', user: 'admin', pass: 'secret', remember: true, connecting: true };
      case 'executing': return { ...b, cmd: { status: 'executing', action: '開燈' } };
      case 'transmitted': return { ...b, source: 'app', cmd: { status: 'transmitted', action: '套用燈光設定' } };
      case 'failed': return { ...b, cmd: { status: 'failed', action: '關燈', code: 'RADIO_UNAVAILABLE' } };
      case 'unknown': return { ...b, cmd: { status: 'unknown', action: '關燈', code: 'UNKNOWN_OUTCOME' } };
      case 'reconnect': return { ...b, online: false, lastSync: '21:13:52' };
      case 'boot': return { ...b, source: 'restored', banner: 'boot', lastSync: '21:14:10', remote: null };
      case 'connected': return b;
      default: return { ...b, draft: { front: 75, temp: 3500 } };
    }
  }

  function create(c) {
    let timers = [];
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));
    const clear = () => { timers.forEach(clearTimeout); timers = []; };
    const set = (p) => c.setState(p);
    const st = () => c.state;
    const reset = () => { clear(); c.setState({ ...seed(c.props.scenario || 'ready'), searchScenario: c.props.scenario }); };
    reset();
    const send = (action, apply) => {
      set({ cmd: { status: 'executing', action }, banner: null });
      later(1300, () => c.setState((s) => ({ cmd: { status: 'transmitted', action }, desired: apply(s.desired), source: 'app', lastSync: clock() })));
    };
    const lookup = () => {
      const action = st().cmd?.action || '命令';
      set({ cmd: { status: 'executing', action } });
      later(900, () => set({ cmd: { status: 'transmitted', action }, banner: null }));
    };

    function view() {
      const s = st();
      if (!s.phase) return null;
      const platform = c.props.platform || 'windows';
      const keychain = { windows: 'Windows 認證管理員', macos: 'macOS 鑰匙圈', ios: 'iOS 鑰匙圈' }[platform];
      const connected = s.phase === 'connected';
      const exec = s.cmd?.status === 'executing';
      const unknown = s.cmd?.status === 'unknown';
      const lock = !connected ? null : !s.online ? 'offline' : !s.radioReady ? 'radio' : exec ? 'busy' : unknown ? 'unknown' : null;
      const LOCK = { offline: '已斷線', radio: '無線模組未就緒', busy: '處理中', unknown: '結果不明，請先查詢' };

      let banner = { show: false };
      if (lock === 'offline') banner = { show: true, kind: 'warn', title: '已斷線，重試中', body: `最後同步 ${s.lastSync}。不會重送先前的操作。`, action: '立即重試', onAction: () => later(600, () => set({ online: true, lastSync: clock() })) };
      else if (lock === 'unknown') banner = { show: true, kind: 'warn', title: '上一筆結果不明', body: `請先查詢「${s.cmd.action}」的結果。`, action: '查詢命令結果', onAction: lookup };
      else if (lock === 'busy') banner = { show: true, kind: 'info', title: '處理中', body: '' };
      else if (s.banner === 'boot') banner = { show: true, kind: 'info', title: '橋接器已重新開機', body: '已重新同步，先前的命令結果無法查詢。', action: '知道了', onAction: () => set({ banner: null }) };
      banner.hasAction = !!banner.action;

      const badge = !connected ? (s.connecting ? { kind: 'pending', text: '連線中' } : { kind: 'idle', text: '未連線' })
        : s.online ? { kind: 'ok', text: '已連線' } : { kind: 'warn', text: '已斷線 · 重試中' };

      const cmd = s.cmd;
      let fb;
      if (!cmd) fb = { kind: 'idle', title: s.online ? '就緒' : '等待連線', body: '' };
      else if (cmd.status === 'executing') fb = { kind: 'busy', title: '處理中', body: `正在送出「${cmd.action}」` };
      else if (cmd.status === 'transmitted') fb = { kind: 'ok', title: '指令已送出', body: '掛燈不回報狀態，請以實際燈光為準。' };
      else if (cmd.status === 'failed') fb = { kind: 'err', title: '發送失敗', body: '請稍後再試。', code: cmd.code };
      else fb = { kind: 'warn', title: '結果不明', body: '請先查詢，不要重送。', code: cmd.code, hasLookup: true };
      fb.hasCode = !!fb.code; fb.group = GROUPS[fb.code] || ''; fb.hasLookup = !!fb.hasLookup;

      const d = s.desired;
      const locked = !!lock;
      const settingsDisabled = locked;
      const values = { ...d, ...s.draft };
      const draftKeys = Object.keys(s.draft);
      const hasDraft = draftKeys.length > 0;
      const setDraft = (k, v) => c.setState((x) => { const nd = { ...x.draft }; if (x.desired[k] === v) delete nd[k]; else nd[k] = v; return { draft: nd }; });
      const pct = (sl, v) => ((v - sl.min) / (sl.max - sl.min)) * 100;
      const sliders = SLIDERS.map((sl) => {
        const drafted = sl.key in s.draft;
        return { ...sl, value: values[sl.key], target: d[sl.key], drafted, isTemp: sl.key === 'temp',
          valueText: `${values[sl.key]}${sl.unit}`, targetText: `${d[sl.key]}${sl.unit}`,
          valuePct: pct(sl, values[sl.key]).toFixed(2) + '%', targetPct: pct(sl, d[sl.key]).toFixed(2) + '%',
          onChange: (e) => { if (!settingsDisabled) setDraft(sl.key, Number(e.target.value)); } };
      });
      const modes = Object.entries(MODES).map(([k, label]) => ({ key: k, label, active: values.mode === k, drafted: values.mode === k && 'mode' in s.draft, isTarget: d.mode === k, onPick: () => { if (!settingsDisabled) setDraft('mode', k); } }));
      const glow = tempColor(d.temp);
      const fOn = d.power && d.mode !== 'back', bOn = d.power && d.mode !== 'front';
      const pOnF = d.power && values.mode !== 'back', pOnB = d.power && values.mode !== 'front';

      const results = (s.results || []).map((r, i) => ({ name: r.name, addr: `${r.host}:${r.port}`, picked: s.picked === i,
        onSelect: () => set({ picked: i, host: r.host, port: r.port, pass: '', searchKind: 'picked', searchMsg: '已填入，請輸入密碼。' }) }));
      const platformHint = { windows: '若曾拒絕防火牆提示，請到「Windows 安全性」允許。', macos: '請確認未開 VPN。', ios: '請在「設定」→「隱私權」→「區域網路」允許。' }[platform];

      const events = s.cleared ? [] : EVENTS;
      const counts = events.reduce((a, e) => (a[e.kind] = (a[e.kind] || 0) + 1, a), {});
      const diag = { device_id: '11111111-1111-4111-8111-111111111111', boot_id: s.banner === 'boot' ? '33333333-3333-4333-8333-333333333333' : '22222222-2222-4222-8222-222222222222', radio: s.radioReady ? 'ready' : 'error', last_command: cmd ? { status: cmd.status, error: cmd.code ? { code: cmd.code } : null } : null };
      const r = s.remote;
      const presetMatch = (p) => ['mode', 'front', 'back', 'temp'].every((k) => p[k] === values[k]);

      return {
        platform, mobile: platform === 'ios', connected, isSetup: !connected,
        badge, banner, lock, locked, lockShort: LOCK[lock] || '',
        fb, lookup,
        desired: d, glow, preview: values, previewGlow: tempColor(values.temp), previewFront: pOnF ? 0.3 + 0.7 * values.front / 100 : 0, previewBack: pOnB ? 0.3 + 0.7 * values.back / 100 : 0, frontLevel: fOn ? 0.3 + 0.7 * d.front / 100 : 0, backLevel: bOn ? 0.3 + 0.7 * d.back / 100 : 0, lit: d.power,
        targetEyebrow: s.online ? '目標' : `最後已知目標 · ${s.lastSync}`, targetPower: d.power ? '開啟' : '關閉', targetMode: MODES[d.mode],
        targetSummary: fmt(d), targetDetail: `前 ${d.front}% · 後 ${d.back}% · ${d.temp} K`, sourceLabel: SRC[s.source], online: s.online,
        powerOn: () => { if (!locked) send('開燈', (x) => ({ ...x, power: true })); },
        powerOff: () => { if (!locked) send('關燈', (x) => ({ ...x, power: false })); },
        powerPress: () => { if (locked) return; d.power ? send('關燈', (x) => ({ ...x, power: false })) : send('開燈', (x) => ({ ...x, power: true })); },
        powerNext: d.power ? '關燈' : '開燈',
        experimental: s.experimental, expOff: !s.experimental, onExperimental: (e) => set({ experimental: e.target ? e.target.checked : !s.experimental, draft: {} }),
        toggleExperimental: () => { if (!locked) set({ experimental: !s.experimental, draft: {} }); },
        settingsDisabled, modes, sliders, hasDraft, draftCount: draftKeys.length,
        applyText: locked ? `已停用：${LOCK[lock]}` : hasDraft ? `${draftKeys.length} 項變更尚未套用` : '按套用才會送出',
        canApply: !settingsDisabled && hasDraft,
        cancelDraft: () => set({ draft: {} }),
        applyDraft: () => { if (settingsDisabled || !hasDraft) return; const patch = s.draft; send('套用燈光設定', (x) => ({ ...x, ...patch })); set({ draft: {} }); },
        presets: s.presets.map((p) => ({ name: p.name, summary: fmt(p), short: `${p.temp} K`, active: presetMatch(p),
          onLoad: () => { if (settingsDisabled) return; const nd = {}; ['mode', 'front', 'back', 'temp'].forEach((k) => { if (p[k] !== d[k]) nd[k] = p[k]; }); set({ draft: nd, presetMsg: '' }); },
          onDelete: () => set({ presets: s.presets.filter((x) => x.id !== p.id), presetMsg: '情境已刪除。' }) })),
        presetsOpen: s.presetsOpen, togglePresets: () => set({ presetsOpen: !s.presetsOpen }), noPresets: !s.presets.length, presetCount: s.presets.length,
        presetName: s.presetName, onPresetName: (e) => set({ presetName: e.target.value.slice(0, 40) }),
        savePreset: () => { const n = s.presetName.trim(); if (!n || s.presets.length >= 20) return; set({ presets: [...s.presets, { id: 'p' + Date.now(), name: n, mode: values.mode, front: values.front, back: values.back, temp: values.temp }], presetName: '', presetMsg: '已保存' }); },
        presetMsg: s.presetMsg, hasPresetMsg: !!s.presetMsg,
        hasRemote: !!r, remote: r ? { power: r.power ? '開燈' : '關燈', summary: fmt(r), detail: `${MODES[r.mode]} · ${r.front}% / ${r.back}% · ${r.temp} K`, ago: r.ago } : {},
        panelOpen: s.panel, openPanel: () => set({ panel: true, tab: 'device' }), openDiag: () => set({ panel: true, tab: 'diag' }), closePanel: () => set({ panel: false }),
        tabs: [['device', '裝置'], ['diag', '診斷']].map(([k, label]) => ({ key: k, label, active: s.tab === k, onPick: () => set({ tab: k }) })),
        tabDevice: s.tab === 'device', tabDiag: s.tab === 'diag',
        deviceName: 'ScreenBar Halo 2', hostPort: `${s.host}:${s.port}`, radioText: s.radioReady ? '就緒' : '未就緒', pairingText: '已保存', lastSync: s.lastSync,
        refresh: () => set({ lastSync: clock() }),
        disconnect: () => { clear(); set({ ...seed('first'), saved: s.saved, host: s.host, port: s.port, user: s.user, remember: !!s.saved }); },
        forget: () => set({ saved: null, remember: false, settingsMsg: '已移除' }),
        settingsMsg: s.settingsMsg, hasSettingsMsg: !!s.settingsMsg, keychain,
        diagSummary: events.length ? `最近 ${events.length} 筆：${counts.ok || 0} 成功 · ${counts.warn || 0} 結果不明 · ${counts.err || 0} 失敗` : '沒有紀錄',
        events, eventCount: events.length, hasEvents: events.length > 0,
        readDiag: () => set({ diagLoaded: true }), clearDiag: () => set({ cleared: true, diagMsg: '歷史紀錄已清除。' }),
        exportDiag: () => set({ diagMsg: platform === 'ios' ? '已匯出：Halo2Control/diagnostics-20260927.json' : platform === 'macos' ? '已匯出：~/Library/Application Support/Halo2Control/diagnostics-20260927.json' : '已匯出：C:\\Users\\me\\AppData\\Roaming\\Halo2Control\\diagnostics-20260927.json' }),
        diagMsg: s.diagMsg, hasDiagMsg: !!s.diagMsg, showFilesHint: platform === 'ios' && s.diagMsg.startsWith('已匯出'),
        filesHint: '「檔案」→「我的 iPhone」→「Halo 2 Control」→「Halo2Control」',
        showRaw: s.showRaw, toggleRaw: () => set({ showRaw: !s.showRaw }), rawLabel: s.showRaw ? '隱藏原始資料' : '顯示原始資料', diagJson: JSON.stringify(diag, null, 2),
        hasSaved: !!s.saved && !connected, savedHost: s.saved ? `${s.saved.host}:${s.saved.port}` : '',
        useSaved: () => { set({ connecting: true, host: s.saved.host, port: s.saved.port }); later(1100, () => set({ ...seed('connected') })); },
        setupBusy: s.searching || s.connecting, searching: s.searching, connecting: s.connecting,
        searchLabel: s.searching ? '搜尋中…約 5 秒' : '搜尋區域網路',
        search: () => { set({ searching: true, results: null, searchMsg: '', picked: null }); later(1800, () => { const none = c.props.scenario === 'noresults'; set({ searching: false, results: none ? [] : FOUND, searchKind: none ? 'empty' : 'found', searchMsg: none ? '找不到橋接器，可直接輸入 IP。' : '' }); }); },
        results, hasResults: results.length > 0, searchMsg: s.searchMsg, hasSearchMsg: !!s.searchMsg, searchEmpty: s.searchKind === 'empty', platformHint,
        host: s.host, port: String(s.port), user: s.user, pass: s.pass, remember: s.remember,
        onHost: (e) => set({ host: e.target.value }), onPort: (e) => set({ port: e.target.value.replace(/\D/g, '') }),
        onUser: (e) => set({ user: e.target.value }), onPass: (e) => set({ pass: e.target.value }),
        onRemember: (e) => set({ remember: e.target ? e.target.checked : !s.remember }), toggleRemember: () => set({ remember: !s.remember }),
        keychainHint: `密碼存於${keychain}`,
        connectLabel: s.connecting ? '連線中…' : '連線',
        connect: () => { if (s.searching) return; set({ connecting: true }); later(1300, () => c.setState((x) => ({ ...seed('connected'), host: x.host, port: x.port, saved: x.remember ? { host: x.host, port: x.port } : null, settingsMsg: '' }))); },
      };
    }
    return { view, reset, dispose: clear };
  }

  // Mount helper for DC logic classes: waits for this script, then seeds state.
  function attach(c) {
    const go = () => { if (c.__halo) return; c.__halo = create(c); c.forceUpdate(); };
    go();
    return {
      update(prev) { if (c.__halo && prev.scenario !== c.props.scenario) c.__halo.reset(); },
      dispose() { c.__halo && c.__halo.dispose(); },
    };
  }
  window.HaloModel = { SCENARIOS, create, attach, tempColor };
})();
