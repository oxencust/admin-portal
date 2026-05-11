/**
 * hendia-liff/_shared/callApi.js
 *
 * Sprint 3 Phase 5 — 統一 API helper
 *
 * 用途：
 *   把各前端 LIFF 對 Supabase Edge Function / Zeabur service 的呼叫集中到單一 helper，
 *   讓 Phase 5 把 11 個 API 從 Edge 搬到 Zeabur 時，前端只需「改 endpoint 表」即可，
 *   不用每個 LIFF 散打改 URL。
 *
 * 啟用方式（在 LIFF html 內）：
 *   <script src="../../_shared/callApi.js"></script>   <!-- 路徑依該頁深度調整 -->
 *   <script>
 *     // 之後就能直接：
 *     const result = await HendiaApi.callApi('notify-coaches', {
 *       request_id: requestId,
 *       sender_id: studentId,
 *       sender_name: studentName,
 *       force_notify: true,
 *     });
 *   </script>
 *
 * Killswitch（緊急 rollback 切回 Supabase Edge）：
 *   - localStorage.setItem('HENDIA_API_FORCE_EDGE', '1')   // 全域對所有 service
 *   - localStorage.setItem('HENDIA_API_FORCE_EDGE_notify-coaches', '1')   // 單一 service
 *   - 或 URL 加 ?force_edge=1（一次性測試用）
 *
 * Phase 4 Audit-Service rollback 模式相同（AUDIT_TARGET=both / zeabur）。
 *
 * 維護者：Sprint 3 / Wave 1（2026-05-09 開）
 */

(function (global) {
  'use strict';

  // 從 URL 撈一次性開關
  var _urlForce = false;
  try {
    var u = new URLSearchParams(global.location && global.location.search);
    if (u.get('force_edge') === '1') _urlForce = true;
  } catch (_) {}

  // ── 共用 anon key（Supabase Edge Function 需要）──
  // 各 LIFF 載入 callApi.js 之前，可以先 set window.SUPABASE_ANON_KEY = '...';
  // 否則 fallback 用 hardcoded（與目前各 LIFF 共用同一把）
  var DEFAULT_SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uamlsaHB6dG5vd2FwbGdndmtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MDA0ODYsImV4cCI6MjA4MTI3NjQ4Nn0.X3e9DF3iT2KUR9ma3_Ins01vG607R155v0xia8hO_Qg';

  function anonKey() {
    return (global.SUPABASE_ANON_KEY || '').toString().trim() || DEFAULT_SUPABASE_ANON_KEY;
  }

  // ── Endpoint registry ────────────────────────────────────────────
  // Phase 5 各 API 在這裡列雙鏈接（zeabur + edge），切換邏輯在 resolveEndpoint() 處理。
  //
  // 加新 service 時：
  //   1) 在這裡新增一筆 { zeabur, edge, zeaburPath?, edgeRequiresAuth?, zeaburRequiresAuth? }
  //   2) 該 service 在 Zeabur 部署完，「沒切前」zeabur 設 null（會強制走 edge）
  //   3) 部署 + 內部 smoke 完，把 zeabur 填上 → 全前端自動走 Zeabur
  //
  // path 預設是 '/' 或 service 自己定義（notify-coaches-service 是 '/notify'）
  var ENDPOINTS = {
    'notify-coaches': {
      // ── Zeabur（Wave 1 Step 1）──
      // 部署完成後把這個 URL 填進來，前端就會自動切過去
      zeabur: 'https://notify-coaches-hendia.zeabur.app/notify',

      // ── Supabase Edge Function（rollback 用，保留 7 天再拔）──
      edge: 'https://mnjilhpztnowaplggvkk.supabase.co/functions/v1/notify-coaches',

      // Edge 需要 anon key headers；Zeabur 是 public POST 不用
      edgeRequiresAuth: true,
      zeaburRequiresAuth: false,
    },

    // ── Wave 1 Step 2（2026-05-11 部署完成）──
    // Zeabur service 已上線、健康檢查通過、雙 token 架構（STAFF + OFFICIAL，OFFICIAL 暫空）
    // OFFICIAL 未設時，target_type='student' 推送會被服務端短路為 false（不影響 coach 群通知）
    'send-chat-notify': {
      zeabur: 'https://send-chat-notify-hendia.zeabur.app/notify',
      edge: 'https://mnjilhpztnowaplggvkk.supabase.co/functions/v1/send-chat-notify',
      edgeRequiresAuth: true,
      zeaburRequiresAuth: false,
    },

    // ── Wave 2-4 之後加 ──
  };

  // 決定該 service 走 zeabur 還是 edge
  function resolveEndpoint(serviceName) {
    var ep = ENDPOINTS[serviceName];
    if (!ep) {
      throw new Error('[callApi] Unknown service: ' + serviceName +
        ' (registered: ' + Object.keys(ENDPOINTS).join(', ') + ')');
    }

    var forceEdge = false;
    try {
      // 1) URL killswitch
      if (_urlForce) forceEdge = true;
      // 2) 全域 localStorage killswitch
      if (!forceEdge && global.localStorage &&
        global.localStorage.getItem('HENDIA_API_FORCE_EDGE') === '1') {
        forceEdge = true;
      }
      // 3) 單一 service localStorage killswitch
      if (!forceEdge && global.localStorage &&
        global.localStorage.getItem('HENDIA_API_FORCE_EDGE_' + serviceName) === '1') {
        forceEdge = true;
      }
    } catch (_) {}

    // Zeabur 沒填（還沒部署 / 還沒切）→ 強制 edge
    if (!ep.zeabur) forceEdge = true;

    var url = forceEdge ? ep.edge : ep.zeabur;
    var requiresAuth = forceEdge ? !!ep.edgeRequiresAuth : !!ep.zeaburRequiresAuth;

    if (!url) {
      throw new Error('[callApi] Service ' + serviceName +
        ' has no usable endpoint (zeabur=null and edge=null)');
    }

    return { url: url, requiresAuth: requiresAuth, mode: forceEdge ? 'edge' : 'zeabur' };
  }

  /**
   * callApi(serviceName, body, opts?)
   *   - serviceName: ENDPOINTS 的 key (e.g. 'notify-coaches')
   *   - body: POST body 物件，會 JSON.stringify
   *   - opts:
   *       returnRaw: true   → 回傳原始 Response 物件（不要 .json()）
   *       headers: {}       → 額外 header（會合併進預設）
   *       fireAndForget: true → 不等 response，直接 return Promise（與原本 .catch 模式相容）
   *       signal: AbortSignal
   *
   * 回傳：
   *   預設 → Promise<解析後的 JSON>
   *   returnRaw → Promise<Response>
   *   throws → 任何 fetch / non-2xx 錯誤
   */
  async function callApi(serviceName, body, opts) {
    opts = opts || {};
    var resolved = resolveEndpoint(serviceName);

    var headers = Object.assign(
      { 'Content-Type': 'application/json' },
      opts.headers || {}
    );
    if (resolved.requiresAuth) {
      var k = anonKey();
      headers['Authorization'] = 'Bearer ' + k;
      headers['apikey'] = k;
    }

    var fetchOpts = {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body || {}),
    };
    if (opts.signal) fetchOpts.signal = opts.signal;

    if (opts.fireAndForget) {
      // 不等結果，與原 student/chat 的 .catch 模式相容
      return fetch(resolved.url, fetchOpts).catch(function (err) {
        console.log('[callApi] ' + serviceName + ' fire-and-forget error:', err);
      });
    }

    var res = await fetch(resolved.url, fetchOpts);
    if (opts.returnRaw) return res;

    if (!res.ok) {
      var text = '';
      try { text = await res.text(); } catch (_) {}
      var msg = '[callApi] ' + serviceName + ' (' + resolved.mode +
        ') HTTP ' + res.status + ': ' + text.substring(0, 200);
      console.warn(msg);
      throw new Error(msg);
    }

    try {
      return await res.json();
    } catch (e) {
      console.warn('[callApi] ' + serviceName + ' JSON parse failed:', e);
      throw e;
    }
  }

  // 對外公開
  global.HendiaApi = {
    callApi: callApi,
    resolveEndpoint: resolveEndpoint,    // for debug
    _endpoints: ENDPOINTS,                 // for debug
  };
})(typeof window !== 'undefined' ? window : globalThis);
