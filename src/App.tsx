import { useCallback, useState } from 'react';
import { Home } from './components/Home';
import { Analytics } from './components/Analytics';
import { RecurringView } from './components/RecurringView';
import { SettingsView } from './components/SettingsView';
import { ExpenseForm } from './components/ExpenseForm';
import { SettleUp } from './components/SettleUp';
import { ReceiptScan } from './components/ReceiptScan';
import { Icon, ToastHost } from './components/ui';
import { store, useStore } from './lib/store';
import type { Expense, Recurring, Settlement } from './lib/types';

export type SheetState =
  | { type: 'expense'; expense?: Expense }
  | { type: 'recurring'; recurring?: Recurring }
  | { type: 'settle'; settlement?: Settlement }
  | { type: 'receipt' }
  | null;

type Tab = 'ledger' | 'stats' | 'repeat' | 'settings';

const TITLES: Record<Tab, string> = { ledger: 'Billsplit', stats: 'Spending', repeat: 'Repeating', settings: 'Settings' };

export default function App() {
  const { sync, device, settings, loaded } = useStore();
  const [tab, setTab] = useState<Tab>('ledger');
  const [sheet, setSheet] = useState<SheetState>(null);
  const close = useCallback(() => setSheet(null), []);

  const go = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  const dot = sync.state === 'synced' ? 'ok' : sync.state === 'syncing' ? 'busy' : sync.state === 'error' ? 'bad' : sync.state === 'offline' ? 'warn' : '';
  const pill = { local: 'On this phone', 'signed-out': 'Signed out', syncing: 'Syncing', synced: 'Synced', offline: 'Offline', error: 'Sync error' }[sync.state];

  if (!loaded) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center', minHeight: '80dvh' }}>
        <img src="icons/icon-192.png" alt="" style={{ width: 64, height: 64, borderRadius: 18, opacity: 0.9 }} />
      </div>
    );
  }

  if (!device.onboarded) {
    return (
      <div className="app">
        <div className="welcome">
          <img className="logo" src="icons/icon-192.png" alt="" />
          <h2>Welcome to Billsplit</h2>
          <p className="text-2">Whose phone is this?</p>
        </div>
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          {(['tom', 'nuria'] as const).map((p) => (
            <button key={p} className="btn" style={{ minHeight: 64, fontSize: 18 }} onClick={() => store.setDevice({ me: p, onboarded: true })}>
              <span className={p}>I’m {settings.names[p]}</span>
            </button>
          ))}
        </div>
        <p className="small-print" style={{ textAlign: 'center', marginTop: 18 }}>You can change this later in Settings.</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>{TITLES[tab]}</h1>
        <button className="sync-pill" onClick={() => go('settings')} aria-label={`Sync status: ${pill}`}>
          <span className={`dot ${dot}`} />
          {pill}
        </button>
      </header>

      <main>
        {tab === 'ledger' && <Home open={setSheet} />}
        {tab === 'stats' && <Analytics />}
        {tab === 'repeat' && <RecurringView open={setSheet} />}
        {tab === 'settings' && <SettingsView />}
      </main>

      <nav className="tabbar" aria-label="Main">
        <div className="tabbar-inner">
          <TabBtn active={tab === 'ledger'} onClick={() => go('ledger')} icon="list" label="Ledger" />
          <TabBtn active={tab === 'stats'} onClick={() => go('stats')} icon="chart" label="Spending" />
          <button className="fab" onClick={() => setSheet({ type: 'expense' })} aria-label="Add expense">
            <Icon name="plus" size={28} stroke={2.4} />
          </button>
          <TabBtn active={tab === 'repeat'} onClick={() => go('repeat')} icon="repeat" label="Repeating" />
          <TabBtn active={tab === 'settings'} onClick={() => go('settings')} icon="settings" label="Settings" />
        </div>
      </nav>

      {sheet?.type === 'expense' && <ExpenseForm mode="expense" initial={sheet.expense} onClose={close} />}
      {sheet?.type === 'recurring' && <ExpenseForm mode="recurring" initial={sheet.recurring} onClose={close} />}
      {sheet?.type === 'settle' && <SettleUp initial={sheet.settlement} onClose={close} />}
      {sheet?.type === 'receipt' && <ReceiptScan onClose={close} />}
      <ToastHost />
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: 'list' | 'chart' | 'repeat' | 'settings'; label: string }) {
  return (
    <button className={`tab${active ? ' active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} size={22} />
      {label}
    </button>
  );
}
