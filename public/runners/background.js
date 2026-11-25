// Capacitor Background Runner Worker script
// Runs in a headless background JS runtime on mobile devices (Android / iOS)

addEventListener('syncOfflineQueue', async (resolve, reject, args) => {
  try {
    console.log('[BackgroundRunner] Woke up to check and sync offlineQueue...');
    
    // 1. Read stored server config or use candidate servers (production VPS first)
    let candidateServers = [
      'http://72.62.158.128:3000',
      'http://72.62.158.128',
      'https://ais-pre-xlqzraiyfzyn3zp3b3j5o7-947254878994.europe-west2.run.app'
    ];
    if (typeof CapacitorKV !== 'undefined') {
      try {
        const storedKeys = ['alkarrar_custom_server_url', 'alkarrar_backend_server_url'];
        for (const k of storedKeys) {
          const custom = await CapacitorKV.get(k);
          if (
            custom &&
            typeof custom === 'string' &&
            (custom.startsWith('http://') || custom.startsWith('https://')) &&
            !custom.includes('localhost') &&
            !custom.includes('127.0.0.1') &&
            !custom.includes('ais-dev-') &&
            !custom.includes('ais-pre-') &&
            !custom.includes('5x4c6bq6p4ul7njqnkzon5') &&
            !custom.includes('asc5xuvnur4hlmpl5rfxpz')
          ) {
            const cleanCustom = custom.replace(/\/+$/, '');
            if (!candidateServers.includes(cleanCustom)) {
              candidateServers.unshift(cleanCustom);
            }
          }
        }
      } catch (e) {}
    }
    
    let queue = [];
    if (typeof CapacitorKV !== 'undefined') {
      try {
        const raw = await CapacitorKV.get('alkarrar_offline_pending_queue');
        if (raw && typeof raw === 'string') {
          queue = JSON.parse(raw);
        }
      } catch (e) {
        console.warn('[BackgroundRunner] CapacitorKV read error:', e);
      }
    }

    if (!Array.isArray(queue) || queue.length === 0) {
      console.log('[BackgroundRunner] No pending offline actions found in queue.');
      return resolve({ status: 'no_pending_items', syncedCount: 0 });
    }

    const pendingActions = queue.filter(item => item && item.status !== 'synced' && !item.id?.startsWith('__meta_'));
    if (pendingActions.length === 0) {
      return resolve({ status: 'no_pending_items', syncedCount: 0 });
    }

    console.log(`[BackgroundRunner] Found ${pendingActions.length} pending items. Uploading to backend servers...`);
    const processedIds = [];

    // Path 1: Batch sync to PostgreSQL backend
    let activeWorkingServer = candidateServers[0];
    for (const sUrl of candidateServers) {
      if (processedIds.length > 0) break;
      try {
        const batchResp = await fetch(`${sUrl}/api/sync/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ actions: pendingActions, timestamp: Date.now() }),
        });
        if (batchResp && batchResp.ok) {
          const ct = (batchResp.headers && typeof batchResp.headers.get === 'function' ? batchResp.headers.get('content-type') || '' : '').toLowerCase();
          if (ct.includes('text/html')) continue;
          const batchJson = await batchResp.json().catch(() => null);
          if (!batchJson) continue;
          activeWorkingServer = sUrl;
          if (Array.isArray(batchJson.processedIds)) {
            processedIds.push(...batchJson.processedIds);
          } else if (batchJson.success) {
            processedIds.push(...pendingActions.map(a => a.id));
          }
          break;
        }
      } catch (bErr) {
        console.warn('[BackgroundRunner] Batch sync notice for ' + sUrl + ':', bErr);
      }
    }

    // Path 2: Individual REST endpoints fallback for remaining items
    const remainingActions = pendingActions.filter(a => !processedIds.includes(a.id));
    for (const action of remainingActions) {
      try {
        const { type, payload } = action;
        if (!payload) continue;

        let table = '';
        let method = 'POST';
        const docId = typeof payload === 'string' ? payload : (payload.id || payload.contractId);

        if (type.includes('CONTRACT')) table = 'contracts';
        else if (type.includes('PAYMENT') && !type.includes('CONFLICT')) table = 'payments';
        else if (type.includes('INVENTORY')) table = 'inventory';
        else if (type.includes('REP')) table = 'reps';
        else if (type.includes('FUND_TX') || type.includes('FUND_TRANSACTION')) table = 'fund-transactions';
        else if (type.includes('FUND')) table = 'funds';
        else if (type.includes('CUSTOMER_LIST')) table = 'customer-lists';
        else if (type.includes('EMPLOYEE_TX') || type.includes('EMPLOYEE_TRANSACTION')) table = 'employee-transactions';
        else if (type.includes('EMPLOYEE')) table = 'employees';
        else if (type.includes('CONFLICT')) table = 'payment-conflicts';

        if (!table) continue;

        const isDelete = type.startsWith('DELETE_') || type.startsWith('RESOLVE_') || type.startsWith('REJECT_');
        let url = `${activeWorkingServer}/api/${table}`;
        if (isDelete && docId) {
          url += `/${encodeURIComponent(docId)}`;
          method = 'DELETE';
        }

        const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        };

        const body = !isDelete ? JSON.stringify(payload) : undefined;

        const resp = await fetch(url, { method, headers, body });
        if (resp && (resp.ok || resp.status < 400)) {
          processedIds.push(action.id);
        }
      } catch (err) {
        console.warn('[BackgroundRunner] Item upload error:', err);
      }
    }

    if (processedIds.length > 0 && typeof CapacitorKV !== 'undefined') {
      try {
        const updatedQueue = queue.filter(item => !processedIds.includes(item.id));
        await CapacitorKV.set('alkarrar_offline_pending_queue', JSON.stringify(updatedQueue));
      } catch (e) {}
    }

    console.log(`[BackgroundRunner] Finished background sync. Successfully uploaded ${processedIds.length} items.`);
    resolve({ status: 'success', syncedCount: processedIds.length });
  } catch (globalErr) {
    console.error('[BackgroundRunner] Global sync error:', globalErr);
    resolve({ status: 'error', error: String(globalErr) });
  }
});
