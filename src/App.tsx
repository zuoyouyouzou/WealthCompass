import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Eye,
  EyeOff,
  Landmark,
  LockKeyhole,
  Moon,
  Plus,
  Save,
  ShieldCheck,
  Sun,
  Target,
  Trash2,
  WalletCards,
} from "lucide-react";
import ReactECharts from "echarts-for-react";
import { calculateMetrics } from "./domain/calculations";
import type {
  Account,
  AccountKind,
  InvestmentPosition,
  Liability,
  PropertyAsset,
  Transaction,
  TransactionKind,
  WealthState,
} from "./domain/types";
import {
  emptyWealthState,
  getVaultStatus,
  initializeVault,
  isDesktopApp,
  loadWealthData,
  lockVault,
  saveWealthData,
  unlockVault,
} from "./security/api";
import {
  getLockTimeoutMinutes,
  setLockTimeoutMinutes,
} from "./security/session";
import "./styles.css";

type View = "dashboard" | "data" | "transactions" | "settings";
type Theme = "dark" | "light";

const currency = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function App() {
  const [locked, setLocked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(true);
  const [data, setData] = useState<WealthState>(emptyWealthState);
  const [masked, setMasked] = useState(true);
  const [theme, setTheme] = useState<Theme>("dark");
  const [view, setView] = useState<View>("dashboard");
  const [timeoutMinutes, setTimeoutMinutes] = useState(getLockTimeoutMinutes);
  const [notice, setNotice] = useState("");

  const metrics = useMemo(() => calculateMetrics(data), [data]);

  useEffect(() => {
    getVaultStatus()
      .then(setInitialized)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (locked) return;
    let timer = window.setTimeout(() => void performLock(), timeoutMinutes * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void performLock(), timeoutMinutes * 60_000);
    };
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  });

  async function loadDataAfterUnlock() {
    setLoading(true);
    try {
      setData(await loadWealthData());
      setLocked(false);
    } finally {
      setLoading(false);
    }
  }

  async function performLock() {
    await lockVault();
    setLocked(true);
    setMasked(true);
    setData(emptyWealthState());
  }

  async function persist(next: WealthState) {
    setNotice("正在保存...");
    try {
      const saved = await saveWealthData(next);
      setData(saved);
      setNotice("已保存到本地加密数据库");
      window.setTimeout(() => setNotice(""), 2500);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败，请检查数据");
      throw error;
    }
  }

  const money = (value: number) => (masked ? "¥ ****" : currency.format(value));

  if (loading) {
    return <div className="splash-screen">正在读取本地加密数据库...</div>;
  }

  if (!initialized) {
    return (
      <FirstRunScreen
        onInitialized={async () => {
          setInitialized(true);
          await loadDataAfterUnlock();
        }}
      />
    );
  }

  if (locked) {
    return <LockScreen onUnlock={loadDataAfterUnlock} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div>
            <strong>财富罗盘</strong>
            <span>WEALTH COMPASS</span>
          </div>
        </div>
        <nav>
          <NavButton active={view === "dashboard"} label="财富总览" onClick={() => setView("dashboard")} />
          <NavButton active={view === "data"} label="资产与目标" onClick={() => setView("data")} />
          <NavButton active={view === "transactions"} label="收支流水" onClick={() => setView("transactions")} />
          <NavButton active={view === "settings"} label="安全设置" onClick={() => setView("settings")} />
        </nav>
        <div className="privacy-card">
          <ShieldCheck size={18} />
          <div><strong>本地加密</strong><span>数据仅保存在此设备</span></div>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <span className="eyebrow">{data.targets.month || "2026-07"}</span>
            <h1>{viewTitle(view)}</h1>
          </div>
          <div className="header-actions">
            {notice && <span className="save-notice">{notice}</span>}
            <button className="icon-button" aria-label="隐藏或显示金额" onClick={() => setMasked((value) => !value)}>
              {masked ? <EyeOff /> : <Eye />}
            </button>
            <button className="icon-button" aria-label="切换主题" onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun /> : <Moon />}
            </button>
            <button className="lock-button" onClick={() => void performLock()}>
              <LockKeyhole size={16} />锁定
            </button>
          </div>
        </header>

        {view === "dashboard" && (
          <Dashboard data={data} metrics={metrics} money={money} theme={theme} onStart={() => setView("data")} />
        )}
        {view === "data" && <DataEditor data={data} onSave={persist} money={money} />}
        {view === "transactions" && <TransactionEditor data={data} onSave={persist} money={money} />}
        {view === "settings" && (
          <Settings
            timeoutMinutes={timeoutMinutes}
            onTimeoutChange={(value) => {
              setLockTimeoutMinutes(value);
              setTimeoutMinutes(value);
            }}
          />
        )}
      </main>
    </div>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 12) {
      setError("请输入至少 12 位主密码");
      return;
    }
    setSubmitting(true);
    try {
      if (isDesktopApp()) await unlockVault(password);
      setPassword("");
      setError("");
      await onUnlock();
    } catch {
      setError("主密码或安全存储无效");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lock-screen">
      <form className="unlock-card" onSubmit={submit}>
        <div className="lock-emblem"><LockKeyhole size={30} /></div>
        <span className="eyebrow">LOCAL & ENCRYPTED</span>
        <h1>欢迎回到财富罗盘</h1>
        <p>输入主密码解锁本地加密数据库</p>
        <label>主密码
          <input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <span className="form-error">{error}</span>}
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "正在解锁..." : "解锁"}
        </button>
      </form>
    </div>
  );
}

function FirstRunScreen({ onInitialized }: { onInitialized: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function initialize(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 12) return setError("主密码至少需要 12 个字符");
    if (password !== confirmation) return setError("两次输入的主密码不一致");
    setSubmitting(true);
    try {
      const result = await initializeVault(password);
      setPassword("");
      setConfirmation("");
      setRecoveryKey(result.recoveryKey);
      setError("");
    } catch {
      setError("无法初始化本地安全存储");
    } finally {
      setSubmitting(false);
    }
  }

  if (recoveryKey) {
    return (
      <div className="lock-screen">
        <section className="unlock-card recovery-card">
          <div className="lock-emblem"><ShieldCheck size={30} /></div>
          <h1>保存离线恢复密钥</h1>
          <p>这是唯一一次完整显示。请抄写到离线介质。</p>
          <code>{recoveryKey}</code>
          <label className="confirmation-row">
            <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
            我已离线保存恢复密钥
          </label>
          <button className="primary-button" disabled={!saved} onClick={() => void onInitialized()}>
            进入财富罗盘
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="lock-screen">
      <form className="unlock-card" onSubmit={initialize}>
        <div className="lock-emblem"><ShieldCheck size={30} /></div>
        <h1>创建本地安全存储</h1>
        <p>主密码仅在本机用于派生加密密钥。</p>
        <label>主密码
          <input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 12 个字符" />
        </label>
        <label>确认主密码
          <input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </label>
        {error && <span className="form-error">{error}</span>}
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "正在创建..." : "创建安全存储"}
        </button>
      </form>
    </div>
  );
}

function Dashboard({
  data,
  metrics,
  money,
  theme,
  onStart,
}: {
  data: WealthState;
  metrics: ReturnType<typeof calculateMetrics>;
  money: (value: number) => string;
  theme: Theme;
  onStart: () => void;
}) {
  if (!hasAnyData(data)) {
    return (
      <section className="empty-state panel">
        <div className="lock-emblem"><WalletCards size={28} /></div>
        <h2>开始录入真实数据</h2>
        <p>先添加账户余额、房产和负债，再填写 2026-07-01 的期初净资产。</p>
        <button className="primary-button compact" onClick={onStart}><Plus size={16} />开始录入</button>
      </section>
    );
  }

  const chartText = theme === "dark" ? "#8b96a8" : "#667085";
  const chartGrid = theme === "dark" ? "#243041" : "#e7eaf0";
  const trend = [data.openingNetWorth / 10_000, metrics.netWorth / 10_000];

  return (
    <div className="content-stack">
      <section className="hero-card">
        <div>
          <span>当前净资产</span>
          <strong>{money(metrics.netWorth)}</strong>
          <div className={metrics.netWorthGrowth >= 0 ? "positive" : "negative"}>
            {metrics.netWorthGrowth >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
            较期初 {money(metrics.netWorthGrowth)}
          </div>
        </div>
        <div className="hero-breakdown">
          <MiniStat label="总资产" value={money(metrics.netWorth + metrics.liabilities)} />
          <MiniStat label="总负债" value={money(metrics.liabilities)} />
          <MiniStat label="房产净值" value={money(metrics.propertyEquity)} />
        </div>
      </section>

      <section className="target-grid">
        <TargetCard label="净资产增长" current={metrics.netWorthGrowth} target={data.targets.netWorthGrowth} money={money} />
        <TargetCard label="净现金流" current={metrics.netCashFlow} target={data.targets.netCashFlow} money={money} />
        <TargetCard label="投资收益" current={metrics.investmentReturn} target={data.targets.investmentReturn} money={money} />
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><span className="eyebrow">PERIOD TREND</span><h2>期初至当前净资产</h2></div></div>
          <ReactECharts
            style={{ height: 260 }}
            option={{
              grid: { left: 15, right: 18, top: 30, bottom: 8, containLabel: true },
              xAxis: { type: "category", data: ["2026-07-01", "当前"], axisLabel: { color: chartText }, axisLine: { lineStyle: { color: chartGrid } } },
              yAxis: { type: "value", axisLabel: { color: chartText, formatter: "{value}万" }, splitLine: { lineStyle: { color: chartGrid } } },
              tooltip: { trigger: "axis", valueFormatter: (value: number) => `${value.toFixed(2)} 万元` },
              series: [{ data: trend, type: "line", smooth: true, lineStyle: { width: 3, color: "#2dd4bf" }, itemStyle: { color: "#2dd4bf" } }],
            }}
          />
        </article>
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">ATTRIBUTION</span><h2>财富变动归因</h2></div></div>
          <AttributionRow label="外部收入" value={metrics.income} money={money} />
          <AttributionRow label="日常及固定支出" value={-metrics.expenses} money={money} />
          <AttributionRow label="股票收益" value={metrics.stockReturn} money={money} />
          <AttributionRow label="期权收益" value={metrics.optionReturn} money={money} />
          <AttributionRow label="未解释差额" value={metrics.unexplainedDifference} money={money} warning />
        </article>
      </section>

      <section className="account-summary">
        {data.accounts.map((account) => (
          <article className="account-card" key={account.id}>
            <div className={`account-icon ${account.kind}`}>{account.kind === "bank" ? <Landmark /> : <WalletCards />}</div>
            <div><span>{account.name}</span><strong>{money(account.balance)}</strong></div>
            <small>{account.updatedAt} 更新</small>
          </article>
        ))}
      </section>
    </div>
  );
}

function DataEditor({
  data,
  onSave,
  money,
}: {
  data: WealthState;
  onSave: (data: WealthState) => Promise<void>;
  money: (value: number) => string;
}) {
  const [draft, setDraft] = useState(data);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(data), [data]);

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="content-stack">
      <section className="section-toolbar sticky-toolbar">
        <p>这里录入的数据会写入本机 SQLCipher 加密数据库。</p>
        <button className="primary-button compact" disabled={saving} onClick={() => void save()}>
          <Save size={16} />{saving ? "保存中..." : "保存全部"}
        </button>
      </section>

      <section className="editor-grid">
        <EditorPanel title="期初与月度目标">
          <div className="form-grid">
            <Field label="期初净资产（2026-07-01）"><MoneyInput value={draft.openingNetWorth} onChange={(openingNetWorth) => setDraft({ ...draft, openingNetWorth })} /></Field>
            <Field label="目标月份"><input type="month" value={draft.targets.month} onChange={(event) => setDraft({ ...draft, targets: { ...draft.targets, month: event.target.value } })} /></Field>
            <Field label="净资产增长目标"><MoneyInput value={draft.targets.netWorthGrowth} onChange={(netWorthGrowth) => setDraft({ ...draft, targets: { ...draft.targets, netWorthGrowth } })} /></Field>
            <Field label="净现金流目标"><MoneyInput value={draft.targets.netCashFlow} onChange={(netCashFlow) => setDraft({ ...draft, targets: { ...draft.targets, netCashFlow } })} /></Field>
            <Field label="投资收益目标"><MoneyInput value={draft.targets.investmentReturn} onChange={(investmentReturn) => setDraft({ ...draft, targets: { ...draft.targets, investmentReturn } })} /></Field>
          </div>
        </EditorPanel>

        <AccountSection items={draft.accounts} onChange={(accounts) => setDraft({ ...draft, accounts })} money={money} />
        <PropertySection items={draft.properties} onChange={(properties) => setDraft({ ...draft, properties })} money={money} />
        <LiabilitySection items={draft.liabilities} properties={draft.properties} onChange={(liabilities) => setDraft({ ...draft, liabilities })} money={money} />
        <PositionSection items={draft.positions} accounts={draft.accounts} onChange={(positions) => setDraft({ ...draft, positions })} money={money} />
      </section>
    </div>
  );
}

function AccountSection({ items, onChange, money }: { items: Account[]; onChange: (items: Account[]) => void; money: (value: number) => string }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("bank");
  const [balance, setBalance] = useState(0);
  const [date, setDate] = useState("2026-07-01");
  return (
    <EditorPanel title="账户余额">
      <EntryList items={items} render={(item) => <><strong>{item.name}</strong><span>{accountKindLabel(item.kind)} · {money(item.balance)}</span></>} onDelete={(id) => onChange(items.filter((item) => item.id !== id))} />
      <div className="form-grid entry-form">
        <Field label="账户名称"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：招商银行" /></Field>
        <Field label="类型"><select value={kind} onChange={(event) => setKind(event.target.value as AccountKind)}>{Object.entries(accountKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="余额"><MoneyInput value={balance} onChange={setBalance} /></Field>
        <Field label="余额日期"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
      </div>
      <AddButton disabled={!name.trim()} onClick={() => { onChange([...items, { id: crypto.randomUUID(), name: name.trim(), kind, balance, updatedAt: date }]); setName(""); setBalance(0); }} />
    </EditorPanel>
  );
}

function PropertySection({ items, onChange, money }: { items: PropertyAsset[]; onChange: (items: PropertyAsset[]) => void; money: (value: number) => string }) {
  const [name, setName] = useState("");
  const [valuation, setValuation] = useState(0);
  const [date, setDate] = useState("2026-07-01");
  return (
    <EditorPanel title="房产估值">
      <EntryList items={items} render={(item) => <><strong>{item.name}</strong><span>{money(item.valuation)} · {item.updatedAt}</span></>} onDelete={(id) => onChange(items.filter((item) => item.id !== id))} />
      <div className="form-grid entry-form">
        <Field label="房产名称"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="当前估值"><MoneyInput value={valuation} onChange={setValuation} /></Field>
        <Field label="估值日期"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
      </div>
      <AddButton disabled={!name.trim()} onClick={() => { onChange([...items, { id: crypto.randomUUID(), name: name.trim(), valuation, updatedAt: date }]); setName(""); setValuation(0); }} />
    </EditorPanel>
  );
}

function LiabilitySection({ items, properties, onChange, money }: { items: Liability[]; properties: PropertyAsset[]; onChange: (items: Liability[]) => void; money: (value: number) => string }) {
  const [name, setName] = useState("");
  const [balance, setBalance] = useState(0);
  const [propertyId, setPropertyId] = useState("");
  const [date, setDate] = useState("2026-07-01");
  return (
    <EditorPanel title="房贷与其他负债">
      <EntryList items={items} render={(item) => <><strong>{item.name}</strong><span>{money(item.balance)} · {item.updatedAt}</span></>} onDelete={(id) => onChange(items.filter((item) => item.id !== id))} />
      <div className="form-grid entry-form">
        <Field label="负债名称"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="剩余余额"><MoneyInput value={balance} onChange={setBalance} /></Field>
        <Field label="关联房产"><select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}><option value="">不关联</option>{properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="余额日期"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
      </div>
      <AddButton disabled={!name.trim()} onClick={() => { onChange([...items, { id: crypto.randomUUID(), name: name.trim(), balance, propertyId: propertyId || undefined, updatedAt: date }]); setName(""); setBalance(0); }} />
    </EditorPanel>
  );
}

function PositionSection({ items, accounts, onChange, money }: { items: InvestmentPosition[]; accounts: Account[]; onChange: (items: InvestmentPosition[]) => void; money: (value: number) => string }) {
  const [accountId, setAccountId] = useState("");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState<"stock" | "option">("stock");
  const [marketValue, setMarketValue] = useState(0);
  const [costBasis, setCostBasis] = useState(0);
  const [realizedProfit, setRealizedProfit] = useState(0);
  const investmentAccounts = accounts.filter((item) => item.kind === "brokerage" || item.kind === "options");
  return (
    <EditorPanel title="股票与期权持仓">
      <EntryList items={items} render={(item) => <><strong>{item.symbol} · {item.name}</strong><span>{item.assetClass === "stock" ? "股票" : "期权"} · 市值 {money(item.marketValue)}</span></>} onDelete={(id) => onChange(items.filter((item) => item.id !== id))} />
      {investmentAccounts.length === 0 ? <p className="inline-warning">请先添加证券账户或期权账户。</p> : (
        <>
          <div className="form-grid entry-form">
            <Field label="所属账户"><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">请选择</option>{investmentAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="类别"><select value={assetClass} onChange={(event) => setAssetClass(event.target.value as "stock" | "option")}><option value="stock">A股股票</option><option value="option">股指 / ETF 期权</option></select></Field>
            <Field label="证券代码"><input value={symbol} onChange={(event) => setSymbol(event.target.value)} /></Field>
            <Field label="证券名称"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="当前市值"><MoneyInput value={marketValue} onChange={setMarketValue} /></Field>
            <Field label="持仓成本"><MoneyInput value={costBasis} onChange={setCostBasis} /></Field>
            <Field label="已实现收益"><MoneyInput value={realizedProfit} onChange={setRealizedProfit} /></Field>
          </div>
          <AddButton disabled={!accountId || !symbol.trim() || !name.trim()} onClick={() => { onChange([...items, { id: crypto.randomUUID(), accountId, symbol: symbol.trim(), name: name.trim(), marketValue, costBasis, realizedProfit, assetClass }]); setSymbol(""); setName(""); setMarketValue(0); setCostBasis(0); setRealizedProfit(0); }} />
        </>
      )}
    </EditorPanel>
  );
}

function TransactionEditor({ data, onSave, money }: { data: WealthState; onSave: (data: WealthState) => Promise<void>; money: (value: number) => string }) {
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [date, setDate] = useState("2026-07-01");
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState("餐饮");
  const [accountId, setAccountId] = useState("");
  const [targetAccountId, setTargetAccountId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function addAndSave() {
    if (!accountId || amount <= 0 || (kind === "transfer" && (!targetAccountId || targetAccountId === accountId))) return;
    const item: Transaction = {
      id: crypto.randomUUID(),
      date,
      kind,
      amount,
      category: kind === "transfer" ? "内部转账" : category.trim() || "其他",
      accountId,
      targetAccountId: kind === "transfer" ? targetAccountId : undefined,
      note: note.trim() || undefined,
    };
    setSaving(true);
    try {
      await onSave({ ...data, transactions: [item, ...data.transactions] });
      setAmount(0);
      setNote("");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      await onSave({ ...data, transactions: data.transactions.filter((item) => item.id !== id) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="content-stack">
      <EditorPanel title="新增收支流水">
        {data.accounts.length === 0 ? <p className="inline-warning">请先在“资产与目标”中添加账户。</p> : (
          <>
            <div className="form-grid">
              <Field label="类型"><select value={kind} onChange={(event) => setKind(event.target.value as TransactionKind)}><option value="income">收入</option><option value="expense">支出</option><option value="transfer">内部转账</option></select></Field>
              <Field label="日期"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
              <Field label="金额"><MoneyInput value={amount} onChange={setAmount} /></Field>
              <Field label="账户"><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">请选择</option>{data.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
              {kind === "transfer" ? (
                <Field label="转入账户"><select value={targetAccountId} onChange={(event) => setTargetAccountId(event.target.value)}><option value="">请选择</option>{data.accounts.filter((item) => item.id !== accountId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
              ) : (
                <Field label="分类"><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="餐饮、工资、房贷等" /></Field>
              )}
              <Field label="备注"><input value={note} onChange={(event) => setNote(event.target.value)} /></Field>
            </div>
            <button className="primary-button compact" disabled={saving || amount <= 0 || !accountId} onClick={() => void addAndSave()}>
              <Plus size={16} />添加并保存
            </button>
          </>
        )}
      </EditorPanel>
      <EditorPanel title={`流水明细（${data.transactions.length}）`}>
        <EntryList
          items={data.transactions}
          render={(item) => <><strong>{item.date} · {item.category}</strong><span>{transactionKindLabel(item.kind)} · {money(item.amount)}{item.note ? ` · ${item.note}` : ""}</span></>}
          onDelete={(id) => void remove(id)}
        />
      </EditorPanel>
    </div>
  );
}

function Settings({ timeoutMinutes, onTimeoutChange }: { timeoutMinutes: number; onTimeoutChange: (value: number) => void }) {
  return (
    <div className="settings-grid">
      <section className="panel"><ShieldCheck className="feature-icon" /><h2>数据库加密</h2><p>SQLCipher 全库加密，密钥由 Argon2id 从主密码派生。</p><span className="status-chip good">已启用</span></section>
      <section className="panel"><LockKeyhole className="feature-icon" /><h2>自动锁定</h2><p>无操作后清除 Rust 内存中的数据库密钥。</p><select value={timeoutMinutes} onChange={(event) => onTimeoutChange(Number(event.target.value))}>{[5, 10, 15, 30].map((value) => <option value={value} key={value}>{value} 分钟</option>)}</select></section>
      <section className="panel"><Building2 className="feature-icon" /><h2>数据位置</h2><p>账户、资产、流水和目标均保存在 Windows 应用数据目录中的加密数据库。</p></section>
    </div>
  );
}

function EditorPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel editor-panel"><h2>{title}</h2>{children}</section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function MoneyInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <input type="number" step="0.01" value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} />;
}

function AddButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return <button type="button" className="secondary-button add-button" disabled={disabled} onClick={onClick}><Plus size={15} />添加到待保存列表</button>;
}

function EntryList<T extends { id: string }>({ items, render, onDelete }: { items: T[]; render: (item: T) => React.ReactNode; onDelete: (id: string) => void }) {
  if (items.length === 0) return <p className="empty-list">暂无记录</p>;
  return (
    <div className="entry-list">
      {items.map((item) => <div className="entry-row" key={item.id}><div>{render(item)}</div><button className="delete-button" aria-label="删除" onClick={() => onDelete(item.id)}><Trash2 size={15} /></button></div>)}
    </div>
  );
}

function NavButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button className={active ? "nav-active" : ""} onClick={onClick}><span />{label}</button>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function TargetCard({ label, current, target, money }: { label: string; current: number; target: number; money: (value: number) => string }) {
  const progress = target > 0 ? Math.max(0, Math.min(100, current / target * 100)) : 0;
  return <article className="target-card"><div className="target-title"><Target size={18} /><span>{label}</span></div><strong>{money(current)}</strong><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><small>{progress.toFixed(0)}% · 目标 {money(target)}</small></article>;
}

function AttributionRow({ label, value, money, warning = false }: { label: string; value: number; money: (value: number) => string; warning?: boolean }) {
  return <div className={`attribution-row ${warning ? "warning" : ""}`}><span>{label}</span><strong className={value >= 0 ? "positive" : "negative"}>{value >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{money(value)}</strong></div>;
}

function hasAnyData(data: WealthState) {
  return data.accounts.length + data.properties.length + data.liabilities.length + data.positions.length + data.transactions.length > 0 || data.openingNetWorth !== 0;
}

const accountKinds: Record<AccountKind, string> = {
  bank: "银行卡",
  alipay: "支付宝",
  brokerage: "证券账户",
  options: "期权账户",
  custom: "其他账户",
};

function accountKindLabel(kind: AccountKind) {
  return accountKinds[kind];
}

function transactionKindLabel(kind: TransactionKind) {
  return { income: "收入", expense: "支出", transfer: "内部转账" }[kind];
}

function viewTitle(view: View) {
  return { dashboard: "财富总览", data: "资产与目标", transactions: "收支流水", settings: "安全设置" }[view];
}

export default App;
