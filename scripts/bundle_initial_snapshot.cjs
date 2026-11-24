const fs = require('fs');
const path = require('path');

try {
  const dataDir = path.join(__dirname, '..', 'data');
  const publicDir = path.join(__dirname, '..', 'public');

  const readFileSafe = (filename) => {
    try {
      const filePath = path.join(dataDir, filename);
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (e) {}
    return [];
  };

  const contracts = readFileSafe('contracts.json');
  const payments = readFileSafe('payments.json');
  const appointments = readFileSafe('appointments.json');
  const customerLists = readFileSafe('customer_lists.json');
  const cashFunds = readFileSafe('cash_funds.json');
  const funds = cashFunds.length > 0 ? cashFunds : readFileSafe('funds.json');
  const reps = readFileSafe('reps.json');
  const inventory = readFileSafe('inventory_items.json');
  const employees = readFileSafe('employees.json');

  const outPath = path.join(publicDir, 'initial_snapshot.json');
  const isDemoOrEmpty =
    !Array.isArray(contracts) ||
    contracts.length === 0 ||
    (contracts.length <= 2 &&
      contracts.every((c) => c && (c.id === 'contract-1' || c.id === 'contract-2')));

  if (isDemoOrEmpty && fs.existsSync(outPath)) {
    try {
      const existingSnap = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      if (Array.isArray(existingSnap?.contracts) && existingSnap.contracts.length > 2) {
        console.log(`[Snapshot Bundler] Kept existing initial_snapshot.json (${existingSnap.contracts.length} contracts) instead of overwriting with ${contracts.length} contracts.`);
        process.exit(0);
      }
    } catch (e) {}
  }

  const snapshot = {
    timestamp: Date.now(),
    contracts,
    payments,
    appointments,
    customerLists,
    funds,
    reps,
    inventory,
    employees,
  };

  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`[Snapshot Bundler] Successfully bundled initial snapshot (${contracts.length} contracts, ${payments.length} payments, ${appointments.length} appointments).`);
} catch (err) {
  console.warn('[Snapshot Bundler] Warning:', err.message);
}
