"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import {
  Pulse,
  ArrowCounterClockwise,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowsLeftRight,
  Bank,
  CaretDown,
  CheckCircle,
  CircleNotch,
  Clock,
  CurrencyDollar,
  Gauge,
  GitBranch,
  House,
  ListChecks,
  MagnifyingGlass,
  Moon,
  Plus,
  Receipt,
  Sun,
  WarningCircle,
  Wallet,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { client, type Connection } from "../lib/api";
import { currencies, friendly, money, relativeTime, shortId, toMinor } from "../lib/money";
import type {
  Account,
  Activity as ActivityEvent,
  Currency,
  OutboxEvent,
  Page,
  Payment,
  PaymentDetail,
  PaymentInput,
  Provider,
  Report,
  Scenario,
  Status,
} from "../types";

const nav: { id: Page; label: string; icon: typeof House }[] = [
  { id: "overview", label: "Overview", icon: House },
  { id: "payments", label: "Payments", icon: Wallet },
  { id: "ledger", label: "Ledger", icon: Receipt },
  { id: "delivery", label: "Event delivery", icon: GitBranch },
  { id: "reconciliation", label: "Reconciliation", icon: ArrowsLeftRight },
];
const providers: Provider[] = ["STRIPE", "RAZORPAY", "PAYPAL"];
const statusTone: Record<string, string> = {
  SUCCEEDED: "good",
  PUBLISHED: "good",
  FAILED: "bad",
  UNKNOWN: "warn",
  PROCESSING: "warn",
  CREATED: "muted",
  PENDING: "warn",
};
const asError = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Please try again.";

export default function Console() {
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [token, setToken] = useState("");
  const [page, setPage] = useState<Page>("overview");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [days, setDays] = useState(7);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [dark, setDark] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const saved = sessionStorage.getItem("ledger-connection");
    if (saved) {
      try {
        const value = JSON.parse(saved) as { token: string };
        if (value.token) {
          setToken(value.token);
          setMode("live");
        }
      } catch {
        sessionStorage.removeItem("ledger-connection");
      }
    }
    setDark(localStorage.getItem("ledger-theme") === "dark");
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("ledger-theme", dark ? "dark" : "light");
  }, [dark]);

  const connection: Connection = useMemo(() => ({ mode, token }), [mode, token]);
  const api = useMemo(() => client(connection), [connection]);
  const overview = useQuery({
    queryKey: [mode, "overview", currency, days],
    queryFn: () => api.overview(currency, days),
  });
  const activity = useQuery({ queryKey: [mode, "activity"], queryFn: () => api.activity() });
  const capabilities = useQuery({
    queryKey: [mode, "capabilities"],
    queryFn: () => api.capabilities(),
  });
  const detail = useQuery({
    queryKey: [mode, "payment", selected],
    queryFn: () => api.detail(selected!),
    enabled: !!selected,
    refetchInterval: (query) =>
      query.state.data && ["CREATED", "PROCESSING", "UNKNOWN"].includes(query.state.data.status)
        ? 1500
        : false,
  });

  useEffect(() => {
    if (mode !== "live" || !token) return;
    const timer = window.setInterval(
      () => void queryClient.invalidateQueries({ queryKey: ["live"] }),
      8000,
    );
    return () => window.clearInterval(timer);
  }, [mode, token, queryClient]);

  const switchMode = (next: "demo" | "live", nextToken = "") => {
    setMode(next);
    setToken(nextToken);
    setSelected(null);
    if (next === "live")
      sessionStorage.setItem("ledger-connection", JSON.stringify({ token: nextToken }));
    else sessionStorage.removeItem("ledger-connection");
    queryClient.clear();
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <a className="brand" href="#overview" onClick={() => setPage("overview")}>
          <span className="brand-mark">
            <span />
          </span>
          <span>
            ledger<span className="brand-slash"> / </span>ops
          </span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <button className="workspace-switch" onClick={() => setConnectionOpen(true)}>
          <span className={`workspace-indicator ${mode}`} />
          {mode === "demo" ? "Sample workspace" : "Live connection"}
          <CaretDown size={14} />
        </button>
        <nav className="primary-nav" aria-label="Main navigation">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={() => {
                setPage(id);
                setMobileNav(false);
              }}
            >
              <Icon size={18} weight={page === id ? "fill" : "regular"} />
              {label}
              {id === "delivery" && (overview.data?.outbox.failed ?? 0) > 0 && (
                <span className="nav-count">{overview.data?.outbox.failed}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-rule" />
          <div className="sidebar-footnote">
            <span className="footnote-dot" />
            {mode === "demo" ? "Preview data · resets on refresh" : "Operator session · scoped API"}
          </div>
          <button className="nav-item quiet" onClick={() => setDark((value) => !value)}>
            {dark ? <Sun size={18} /> : <Moon size={18} />}
            {dark ? "Light appearance" : "Dark appearance"}
          </button>
          <button className="nav-item quiet" onClick={() => setConnectionOpen(true)}>
            <Pulse size={18} />
            Connection settings
          </button>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <main className="main-area">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="Open navigation"
            onClick={() => setMobileNav(true)}
          >
            <ListChecks size={19} />
          </button>
          <div className="breadcrumb">
            Operations <span>/</span> {nav.find((item) => item.id === page)?.label}
          </div>
          <div className="topbar-right">
            <span className="live-clock">
              <span className="pulse-dot" />
              {mode === "demo" ? "SAMPLE DATA" : "CONNECTED"}
            </span>
            <button className="topbar-connection" onClick={() => setConnectionOpen(true)}>
              {mode === "demo" ? "Connect API" : "Manage connection"}
              <ArrowUpRight size={14} />
            </button>
          </div>
        </header>
        <section className="page-content">
          {page === "overview" && (
            <OverviewPage
              api={api}
              mode={mode}
              data={overview.data}
              loading={overview.isLoading}
              error={overview.error}
              activity={activity.data ?? []}
              activityLoading={activity.isLoading}
              activityError={activity.error}
              currency={currency}
              days={days}
              setCurrency={setCurrency}
              setDays={setDays}
              openPayment={setSelected}
              onCreate={() => setCreateOpen(true)}
              goPayments={() => setPage("payments")}
              retry={() => void overview.refetch()}
            />
          )}
          {page === "payments" && (
            <PaymentsPage
              api={api}
              mode={mode}
              currency={currency}
              days={days}
              onCreate={() => setCreateOpen(true)}
              openPayment={setSelected}
            />
          )}
          {page === "ledger" && (
            <LedgerPage api={api} currency={currency} setCurrency={setCurrency} />
          )}
          {page === "delivery" && <DeliveryPage api={api} mode={mode} />}
          {page === "reconciliation" && (
            <ReconciliationPage api={api} currency={currency} setCurrency={setCurrency} />
          )}
        </section>
      </main>
      <PaymentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        api={api}
        currency={currency}
        scenariosEnabled={mode === "demo" || capabilities.data?.mockScenarios === true}
        onCreated={(id) => {
          setPage("payments");
          setSelected(id);
          void queryClient.invalidateQueries();
        }}
      />
      <PaymentDetailDialog
        id={selected}
        detail={detail.data}
        loading={detail.isLoading}
        error={detail.error}
        close={() => setSelected(null)}
        api={api}
      />
      <ConnectionDialog
        open={connectionOpen}
        onOpenChange={setConnectionOpen}
        mode={mode}
        onConnect={(value) => {
          switchMode("live", value);
          setConnectionOpen(false);
        }}
        onDemo={() => {
          switchMode("demo");
          setConnectionOpen(false);
        }}
      />
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}
function PageControls({
  currency,
  setCurrency,
  days,
  setDays,
}: {
  currency: Currency;
  setCurrency: (value: Currency) => void;
  days?: number;
  setDays?: (value: number) => void;
}) {
  return (
    <div className="control-row">
      <label className="select-wrap">
        <span className="sr-only">Currency</span>
        <CurrencyDollar size={15} />
        <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
          {currencies.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <CaretDown size={13} />
      </label>
      {days !== undefined && setDays && (
        <label className="select-wrap">
          <Clock size={15} />
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Today</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <CaretDown size={13} />
        </label>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  note,
  icon: Icon,
  tone = "blue",
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Gauge;
  tone?: string;
}) {
  return (
    <article className="metric">
      <div className="metric-top">
        <span>{label}</span>
        <span className={`metric-icon ${tone}`}>
          <Icon size={17} />
        </span>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">{note}</div>
    </article>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${statusTone[value] ?? "muted"}`}>
      <span />
      {friendly(value)}
    </span>
  );
}
function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="state-box error-state">
      <WarningCircle size={20} />
      <strong>Couldn’t load this view</strong>
      <span>{asError(error)}</span>
      {retry && (
        <button className="text-button" onClick={retry}>
          Try again <ArrowCounterClockwise size={14} />
        </button>
      )}
    </div>
  );
}
function LoadingState({ label = "Loading records" }: { label?: string }) {
  return (
    <div className="state-box">
      <CircleNotch className="spin" size={20} />
      <span>{label}</span>
    </div>
  );
}
function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Receipt size={20} />
      </div>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function OverviewPage({
  api,
  mode,
  data,
  loading,
  error,
  activity,
  activityLoading,
  activityError,
  currency,
  days,
  setCurrency,
  setDays,
  openPayment,
  onCreate,
  goPayments,
  retry,
}: {
  api: ReturnType<typeof client>;
  mode: "demo" | "live";
  data?: Awaited<ReturnType<ReturnType<typeof client>["overview"]>>;
  loading: boolean;
  error: unknown;
  activity: ActivityEvent[];
  activityLoading: boolean;
  activityError: unknown;
  currency: Currency;
  days: number;
  setCurrency: (v: Currency) => void;
  setDays: (v: number) => void;
  openPayment: (id: string) => void;
  onCreate: () => void;
  goPayments: () => void;
  retry: () => void;
}) {
  const recent = useQuery({
    queryKey: [mode, "overview-recent", currency, days],
    queryFn: () => api.list(currency, days, "ALL", "", 1),
  });
  const series = data?.series ?? [];
  const maxMinor =
    series.reduce(
      (maxValue, row) => (BigInt(row.amountMinor) > maxValue ? BigInt(row.amountMinor) : maxValue),
      0n,
    ) || 1n;
  const barHeight = (amount: string) =>
    Math.max(2, Number((BigInt(amount) * 10000n) / maxMinor) / 100);
  return (
    <>
      <PageHeading
        eyebrow="PAYMENT OPERATIONS / 01"
        title="Overview"
        description="A current view of payment activity and ledger health."
        action={
          <>
            <PageControls
              currency={currency}
              setCurrency={setCurrency}
              days={days}
              setDays={setDays}
            />
            <button className="button primary" onClick={onCreate}>
              <Plus size={16} weight="bold" />
              Create payment
            </button>
          </>
        }
      />
      {error ? (
        <ErrorState error={error} retry={retry} />
      ) : loading ? (
        <LoadingState label="Loading overview" />
      ) : (
        <>
          {data && (
            <div className="metrics-grid">
              <Metric
                label="Payment volume"
                value={money(data.volumeMinor, currency)}
                note={`${data.succeeded} successful in selected period`}
                icon={ArrowUpRight}
              />
              <Metric
                label="Success rate"
                value={`${data.totalPayments ? ((data.succeeded / data.totalPayments) * 100).toFixed(1) : "0.0"}%`}
                note={`${data.failed} declined · ${data.pending} unresolved`}
                icon={Gauge}
                tone="green"
              />
              <Metric
                label="Journal integrity"
                value={
                  data.unbalancedJournals === 0 ? "Balanced" : `${data.unbalancedJournals} flagged`
                }
                note={`${data.journalCount} posted journals checked`}
                icon={CheckCircle}
                tone={data.unbalancedJournals ? "amber" : "green"}
              />
              <Metric
                label="Event delivery"
                value={`${data.outbox.pending + data.outbox.failed} open`}
                note={`${data.outbox.failed} failed · ${data.outbox.published} delivered`}
                icon={GitBranch}
                tone={data.outbox.failed ? "amber" : "blue"}
              />
            </div>
          )}
          <div className="overview-grid">
            <section className="panel volume-panel">
              <div className="panel-heading">
                <div>
                  <div className="section-kicker">ACTIVITY</div>
                  <h2>Payment volume</h2>
                  <p>Captured value per day · {currency}</p>
                </div>
                <span className="panel-period">{days}D</span>
              </div>
              <div
                className="chart-area"
                role="img"
                aria-label={`Daily captured payment volume for ${days} days`}
              >
                <div className="chart-guides">
                  <span>{money((maxMinor / 3n).toString(), currency)}</span>
                  <span>{money(((maxMinor * 2n) / 3n).toString(), currency)}</span>
                  <span>{money(maxMinor.toString(), currency)}</span>
                </div>
                <div className="bars">
                  {series.map((row) => (
                    <div
                      className="bar-col"
                      key={row.date}
                      title={`${row.date}: ${money(row.amountMinor, currency)}`}
                    >
                      <div
                        className={`bar ${BigInt(row.amountMinor) > 0n ? "filled" : ""}`}
                        style={{ height: `${barHeight(row.amountMinor)}%` }}
                      />
                      <span>
                        {new Date(`${row.date}T12:00:00`).toLocaleDateString("en-US", {
                          weekday: "narrow",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="chart-footer">
                <span>
                  <i className="legend-dot" />
                  Captured volume
                </span>
                <span>{data?.totalPayments ?? 0} operations total</span>
              </div>
            </section>
            <section className="panel flow-panel">
              <div className="panel-heading">
                <div>
                  <div className="section-kicker">POSTING FLOW</div>
                  <h2>Money movement</h2>
                  <p>Derived from successful operations</p>
                </div>
                <span className="flow-mark">
                  <ArrowsLeftRight size={17} />
                </span>
              </div>
              <div className="flow-account">
                <span className="account-icon provider">
                  <Bank size={17} />
                </span>
                <span>
                  <strong>Provider holding</strong>
                  <small>Debit · {currency}</small>
                </span>
                <strong className="flow-amount">{money(data?.volumeMinor ?? "0", currency)}</strong>
              </div>
              <div className="flow-connector">
                <span />
                <small>balanced journal entries</small>
                <span />
              </div>
              <div className="flow-account">
                <span className="account-icon platform">
                  <CurrencyDollar size={17} />
                </span>
                <span>
                  <strong>Platform revenue</strong>
                  <small>Credit · {currency}</small>
                </span>
                <strong className="flow-amount">{money(data?.volumeMinor ?? "0", currency)}</strong>
              </div>
              <div className="balanced-note">
                <CheckCircle size={15} weight="fill" /> Debits equal credits
              </div>
            </section>
          </div>
          <div className="lower-grid">
            <section className="panel table-panel">
              <div className="panel-heading compact">
                <div>
                  <div className="section-kicker">LATEST ACTIVITY</div>
                  <h2>Recent payments</h2>
                </div>
                <button className="text-button" onClick={goPayments}>
                  All payments <ArrowUpRight size={14} />
                </button>
              </div>
              {recent.isError ? (
                <ErrorState error={recent.error} retry={() => void recent.refetch()} />
              ) : recent.isLoading ? (
                <LoadingState />
              ) : (
                <PaymentRows rows={recent.data?.items.slice(0, 6) ?? []} open={openPayment} />
              )}
            </section>
            <section className="panel activity-panel">
              <div className="panel-heading compact">
                <div>
                  <div className="section-kicker">SYSTEM ACTIVITY</div>
                  <h2>Event timeline</h2>
                </div>
                <Pulse size={17} className="subtle-icon" />
              </div>
              {activityError ? (
                <ErrorState error={activityError} />
              ) : activityLoading ? (
                <LoadingState />
              ) : activity.length ? (
                <div className="timeline">
                  {activity.slice(0, 6).map((event) => (
                    <div className="timeline-item" key={event.id}>
                      <span className="timeline-mark">
                        <CheckCircle size={14} />
                      </span>
                      <div>
                        <strong>{friendly(event.eventType)}</strong>
                        <small>
                          {shortId(event.aggregateId)} <span>·</span>{" "}
                          {relativeTime(event.createdAt)}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No delivered activity"
                  detail="Events will appear here after processing."
                />
              )}
            </section>
          </div>
          <div className="data-footnote">
            <span>
              <span className="footnote-dot" />
              {data
                ? `Snapshot at ${new Date(data.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : "Waiting for snapshot"}
            </span>
            <span>Amounts are shown in {currency}</span>
          </div>
        </>
      )}
    </>
  );
}

function PaymentRows({ rows, open }: { rows: Payment[]; open: (id: string) => void }) {
  const columns = useMemo<ColumnDef<Payment>[]>(
    () => [
      {
        accessorKey: "paymentId",
        header: "Payment",
        cell: ({ row }) => (
          <div className="payment-id">
            <span className="id-mark">P</span>
            <span>
              <strong>{shortId(row.original.paymentId)}</strong>
              <small>
                {row.original.provider} · {relativeTime(row.original.createdAt)}
              </small>
            </span>
          </div>
        ),
      },
      {
        accessorKey: "amountMinor",
        header: "Amount",
        cell: ({ row }) => (
          <span className="amount-cell">
            {money(row.original.amountMinor, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <Status value={row.original.status} />,
      },
    ],
    [],
  );
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  if (!rows.length)
    return (
      <EmptyState title="No payments in this window" detail="Create a payment to start activity." />
    );
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
              <th>
                <span className="sr-only">Open</span>
              </th>
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => open(row.original.paymentId)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter") open(row.original.paymentId);
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
              <td className="row-arrow">
                <ArrowUpRight size={15} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentsPage({
  api,
  mode,
  currency,
  days,
  onCreate,
  openPayment,
}: {
  api: ReturnType<typeof client>;
  mode: "demo" | "live";
  currency: Currency;
  days: number;
  onCreate: () => void;
  openPayment: (id: string) => void;
}) {
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: [mode, "payments", currency, days, status, search, page],
    queryFn: () => api.list(currency, days, status, search, page),
  });
  return (
    <>
      <PageHeading
        eyebrow="PAYMENT OPERATIONS / 02"
        title="Payments"
        description="Search operation state, processor attempts and ledger outcomes."
        action={
          <button className="button primary" onClick={onCreate}>
            <Plus size={16} weight="bold" />
            Create payment
          </button>
        }
      />
      <section className="panel full-table">
        <div className="table-toolbar">
          <label className="search-box">
            <MagnifyingGlass size={16} />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search payment or idempotency key"
              aria-label="Search payments"
            />
          </label>
          <label className="select-wrap">
            <span className="sr-only">Payment status</span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All statuses</option>
              {["SUCCEEDED", "FAILED", "UNKNOWN", "PROCESSING", "CREATED"].map((item) => (
                <option key={item} value={item}>
                  {friendly(item)}
                </option>
              ))}
            </select>
            <CaretDown size={13} />
          </label>
          <span className="table-total">{query.data?.total ?? 0} operations</span>
        </div>
        {query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.isLoading ? (
          <LoadingState />
        ) : (
          <>
            <PaymentRows rows={query.data?.items ?? []} open={openPayment} />
            <div className="pagination">
              <span>
                Page {page} of {Math.max(1, Math.ceil((query.data?.total ?? 0) / 12))}
              </span>
              <div>
                <button
                  className="button subtle"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <button
                  className="button subtle"
                  disabled={page * 12 >= (query.data?.total ?? 0)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      <div className="page-note">
        <CheckCircle size={15} /> Payment records are scoped to the current operator session.
      </div>
    </>
  );
}

function LedgerPage({
  api,
  currency,
  setCurrency,
}: {
  api: ReturnType<typeof client>;
  currency: Currency;
  setCurrency: (v: Currency) => void;
}) {
  const accounts = useQuery({
    queryKey: [api, "accounts", currency],
    queryFn: () => api.accounts(currency),
  });
  const [accountId, setAccountId] = useState("");
  useEffect(() => {
    if (accounts.data?.length && !accounts.data.some((a) => a.id === accountId))
      setAccountId(accounts.data[0].id);
  }, [accounts.data, accountId]);
  const ledger = useQuery({
    queryKey: [api, "ledger", accountId, currency],
    queryFn: () => api.ledger(accountId, currency),
    enabled: !!accountId,
  });
  return (
    <>
      <PageHeading
        eyebrow="ACCOUNTING / 03"
        title="Ledger"
        description="Inspect append-only journal entries and current derived account balances."
        action={<PageControls currency={currency} setCurrency={setCurrency} />}
      />
      {accounts.isError ? (
        <ErrorState error={accounts.error} retry={() => void accounts.refetch()} />
      ) : accounts.isLoading ? (
        <LoadingState label="Loading accounts" />
      ) : !accounts.data?.length ? (
        <div className="panel">
          <EmptyState
            title="No ledger activity for this currency"
            detail="Accounts appear after a successful payment is posted."
          />
        </div>
      ) : (
        <>
          <div className="account-grid">
            {accounts.data.map((account) => (
              <button
                key={account.id}
                className={`account-card ${account.id === accountId ? "selected" : ""}`}
                onClick={() => setAccountId(account.id)}
              >
                <div className="account-card-top">
                  <span className="account-icon provider">
                    <Bank size={17} />
                  </span>
                  <span>{account.type}</span>
                </div>
                <strong>{account.name.replaceAll("_", " ")}</strong>
                <div className="account-balance">
                  {money(account.balanceMinor, currency)} <ArrowUpRight size={15} />
                </div>
                <small>{account.entryCount} entries</small>
              </button>
            ))}
          </div>
          <section className="panel ledger-panel">
            <div className="panel-heading">
              <div>
                <div className="section-kicker">APPEND-ONLY JOURNAL</div>
                <h2>{accounts.data.find((a) => a.id === accountId)?.name.replaceAll("_", " ")}</h2>
                <p>Newest entries first · {currency}</p>
              </div>
              <span className="balance-chip">
                Balance{" "}
                <strong>
                  {money(
                    accounts.data.find((a) => a.id === accountId)?.balanceMinor ?? "0",
                    currency,
                  )}
                </strong>
              </span>
            </div>
            {ledger.isError ? (
              <ErrorState error={ledger.error} retry={() => void ledger.refetch()} />
            ) : ledger.isLoading ? (
              <LoadingState label="Loading ledger entries" />
            ) : !ledger.data?.entries.length ? (
              <EmptyState title="No entries yet" detail="Posted journals will appear here." />
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Journal</th>
                      <th>Type</th>
                      <th>Debit</th>
                      <th>Credit</th>
                      <th>Recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.data.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <code>{shortId(entry.transaction?.id ?? entry.id)}</code>
                        </td>
                        <td>{friendly(entry.transaction?.type ?? "ENTRY")}</td>
                        <td className="amount-cell">
                          {BigInt(entry.debitMinor) ? money(entry.debitMinor, currency) : "—"}
                        </td>
                        <td className="amount-cell">
                          {BigInt(entry.creditMinor) ? money(entry.creditMinor, currency) : "—"}
                        </td>
                        <td>
                          {entry.transaction ? relativeTime(entry.transaction.createdAt) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function DeliveryPage({ api, mode }: { api: ReturnType<typeof client>; mode: "demo" | "live" }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("ALL");
  const query = useQuery({
    queryKey: [mode, "outbox"],
    queryFn: () => api.outbox(),
    refetchInterval: mode === "live" ? 5000 : false,
  });
  const retryMutation = useMutationCompat(
    async (id: string) => api.retry(id),
    () => void queryClient.invalidateQueries({ queryKey: [mode, "outbox"] }),
  );
  const events = (query.data ?? []).filter((event) => filter === "ALL" || event.status === filter);
  return (
    <>
      <PageHeading
        eyebrow="ASYNC PROCESSING / 04"
        title="Event delivery"
        description="Track transactional outbox delivery and retry failed events."
        action={
          <label className="select-wrap">
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="ALL">All events</option>
              <option>PENDING</option>
              <option>PUBLISHED</option>
              <option>FAILED</option>
            </select>
            <CaretDown size={13} />
          </label>
        }
      />
      <div className="delivery-summary">
        <div>
          <span>TRANSPORT</span>
          <strong>{mode === "demo" ? "Sample inbox" : "PostgreSQL inbox"}</strong>
        </div>
        <div>
          <span>DELIVERY MODEL</span>
          <strong>At least once</strong>
        </div>
        <div>
          <span>RETRY POLICY</span>
          <strong>Exponential backoff</strong>
        </div>
        <div className="summary-status">
          <span>FAILED EVENTS</span>
          <strong
            className={
              (query.data?.filter((e) => e.status === "FAILED").length ?? 0) ? "text-danger" : ""
            }
          >
            {query.data?.filter((e) => e.status === "FAILED").length ?? "—"}
          </strong>
        </div>
      </div>
      <section className="panel full-table">
        <div className="panel-heading compact">
          <div>
            <div className="section-kicker">OUTBOX</div>
            <h2>Recent events</h2>
          </div>
          <span className="refresh-caption">
            <span className="pulse-dot" />
            {mode === "live" ? "Refreshing every 5 seconds" : "Sample events"}
          </span>
        </div>
        {query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.isLoading ? (
          <LoadingState />
        ) : events.length === 0 ? (
          <EmptyState
            title="No events match this filter"
            detail="Newly committed operations create outbox events."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Aggregate</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <div className="event-name">
                        <span className="event-mark">
                          <GitBranch size={15} />
                        </span>
                        <span>
                          <strong>{friendly(event.eventType)}</strong>
                          <small>{shortId(event.id)}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <code>{shortId(event.aggregateId)}</code>
                    </td>
                    <td>
                      <Status value={event.status} />
                    </td>
                    <td>{event.attempts}</td>
                    <td>{relativeTime(event.publishedAt ?? event.createdAt)}</td>
                    <td>
                      {event.status === "FAILED" && (
                        <button
                          className="button subtle retry-button"
                          onClick={() => retryMutation.run(event.id)}
                          disabled={retryMutation.pending}
                        >
                          <ArrowCounterClockwise size={14} />
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="page-note">
        <WarningCircle size={15} /> Delivery is at least once. Consumers deduplicate by stable event
        identity.
      </div>
    </>
  );
}

function useMutationCompat<T>(action: (value: T) => Promise<unknown>, done: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const run = async (value: T) => {
    setPending(true);
    setError("");
    try {
      await action(value);
      done();
    } catch (e) {
      setError(asError(e));
    } finally {
      setPending(false);
    }
  };
  return { run, pending, error };
}

function ReconciliationPage({
  api,
  currency,
  setCurrency,
}: {
  api: ReturnType<typeof client>;
  currency: Currency;
  setCurrency: (v: Currency) => void;
}) {
  const queryClient = useQueryClient();
  const report = useQuery({
    queryKey: [api, "reconciliation-report"],
    queryFn: () => api.latestReport(),
  });
  const [provider, setProvider] = useState<Provider>("STRIPE");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setMessage("");
    try {
      await api.reconcile(provider, currency);
      setMessage("Reconciliation completed. The latest report is shown below.");
      await queryClient.invalidateQueries({ queryKey: [api, "reconciliation-report"] });
    } catch (error) {
      setMessage(asError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="FINANCIAL CONTROL / 05"
        title="Reconciliation"
        description="Compare provider-side balances with the internal ledger snapshot."
        action={<PageControls currency={currency} setCurrency={setCurrency} />}
      />
      <section className="reconcile-callout">
        <span className="callout-icon">
          <ArrowsLeftRight size={20} />
        </span>
        <div>
          <strong>Run a balance check</strong>
          <p>
            Compare one provider and currency against the ledger. A report records both values and
            any variance.
          </p>
        </div>
        <label className="select-wrap">
          <span className="sr-only">Processor</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            {providers.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <CaretDown size={13} />
        </label>
        <button className="button primary" onClick={() => void run()} disabled={busy}>
          {busy ? <CircleNotch className="spin" size={15} /> : <ArrowsLeftRight size={15} />}
          {busy ? "Checking" : "Run reconciliation"}
        </button>
      </section>
      {message && (
        <div className={`inline-message ${message.includes("completed") ? "success" : "error"}`}>
          {message}
        </div>
      )}
      <section className="panel report-panel">
        <div className="panel-heading">
          <div>
            <div className="section-kicker">LATEST REPORT</div>
            <h2>Balance comparison</h2>
            <p>Most recent provider reconciliation</p>
          </div>
          {report.data && (
            <Status value={BigInt(report.data.discrepancy) === 0n ? "SUCCEEDED" : "FAILED"} />
          )}
        </div>
        {report.isError ? (
          <ErrorState error={report.error} retry={() => void report.refetch()} />
        ) : report.isLoading ? (
          <LoadingState label="Loading report" />
        ) : !report.data ? (
          <EmptyState
            title="No reconciliation report yet"
            detail="Choose a provider and run a balance check."
          />
        ) : (
          <>
            <div className="report-grid">
              <ReportValue label="Provider" value={report.data.provider} />
              <ReportValue label="Currency" value={report.data.currency} />
              <ReportValue
                label="Expected balance"
                value={money(report.data.expectedBalance, report.data.currency)}
              />
              <ReportValue
                label="Ledger balance"
                value={money(report.data.actualBalance, report.data.currency)}
              />
              <ReportValue
                label="Difference"
                value={money(report.data.discrepancy, report.data.currency)}
                emphasis
              />
            </div>
            <div className="report-footer">
              <span>
                <Clock size={14} />
                Checked {new Date(report.data.createdAt).toLocaleString()}
              </span>
              <span className="report-id">Report {shortId(report.data.id)}</span>
            </div>
          </>
        )}
      </section>
      <div className="page-note">
        <WarningCircle size={15} /> The local mock compares snapshots; it does not represent a live
        external processor connection.
      </div>
    </>
  );
}
function ReportValue({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`report-value ${emphasis ? "emphasis" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PaymentDialog({
  open,
  onOpenChange,
  api,
  currency,
  scenariosEnabled,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  api: ReturnType<typeof client>;
  currency: Currency;
  scenariosEnabled: boolean;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("100.00");
  const [provider, setProvider] = useState<Provider>("STRIPE");
  const [selectedCurrency, setSelectedCurrency] = useState(currency);
  const [scenario, setScenario] = useState<Scenario>("SUCCESS");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const [outcome, setOutcome] = useState("");
  useEffect(() => {
    if (open && !key) setKey(crypto.randomUUID());
  }, [open, key]);
  const submit = async () => {
    setBusy(true);
    setError("");
    setOutcome("");
    try {
      const input: PaymentInput = {
        amountMinor: toMinor(amount, selectedCurrency),
        provider,
        currency: selectedCurrency,
        scenario: scenariosEnabled ? scenario : "SUCCESS",
      };
      const result = await api.create(input, key);
      await queryClient.invalidateQueries();
      if (
        result.status === "UNKNOWN" ||
        result.status === "PROCESSING" ||
        result.status === "CREATED"
      )
        setOutcome(
          `Payment ${shortId(result.paymentId)} is still resolving. Its idempotency key is retained for safe replay.`,
        );
      onCreated(result.paymentId);
      onOpenChange(false);
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) {
          setError("");
          setOutcome("");
          setKey("");
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-top">
            <div>
              <div className="eyebrow">NEW OPERATION</div>
              <Dialog.Title>Create payment</Dialog.Title>
              <Dialog.Description>
                Submit a payment through the selected processor.
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="form-stack">
            <label>
              Amount
              <div className="amount-input">
                <span>{selectedCurrency}</span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                />
                <span className="amount-unit">
                  {selectedCurrency === "JPY" ? "JPY" : "major units"}
                </span>
              </div>
            </label>
            <div className="form-pair">
              <label>
                Currency
                <select
                  value={selectedCurrency}
                  onChange={(e) => setSelectedCurrency(e.target.value as Currency)}
                >
                  {currencies.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                Processor
                <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
                  {providers.map((item) => (
                    <option key={item}>{friendly(item)}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Scenario
              <select
                disabled={!scenariosEnabled}
                value={scenariosEnabled ? scenario : "SUCCESS"}
                onChange={(e) => setScenario(e.target.value as Scenario)}
              >
                <option value="SUCCESS">Successful payment</option>
                {scenariosEnabled && (
                  <>
                    <option value="DECLINE">Processor decline</option>
                    <option value="TIMEOUT_BEFORE">Timeout before result</option>
                    <option value="TIMEOUT_AFTER">Timeout after processor success</option>
                  </>
                )}
              </select>
              <small className="field-hint">
                {scenariosEnabled
                  ? "Choose an outcome to explore delivery and recovery behavior."
                  : "Mock scenarios are disabled by this API; requests use the normal success flow."}
              </small>
            </label>
            <div className="idempotency-info">
              <span className="key-icon">#</span>
              <span>
                <strong>Idempotency protected</strong>
                <small>Retries reuse the same operation key.</small>
              </span>
              <code>{shortId(key || "generating...")}</code>
            </div>
            {error && (
              <div className="form-error">
                <WarningCircle size={16} />
                {error}
              </div>
            )}
            {outcome && (
              <div className="form-pending">
                <Clock size={16} />
                {outcome}
              </div>
            )}
            <div className="dialog-actions">
              <Dialog.Close className="button subtle">Cancel</Dialog.Close>
              <button
                className="button primary"
                onClick={() => void submit()}
                disabled={busy || !key}
              >
                {busy ? <CircleNotch className="spin" size={15} /> : <Plus size={15} />}
                {busy ? "Processing" : outcome ? "Replay safely" : "Process payment"}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PaymentDetailDialog({
  id,
  detail,
  loading,
  error,
  close,
  api,
}: {
  id: string | null;
  detail?: PaymentDetail;
  loading: boolean;
  error: unknown;
  close: () => void;
  api: ReturnType<typeof client>;
}) {
  const queryClient = useQueryClient();
  const [refundAmount, setRefundAmount] = useState("");
  const [refundState, setRefundState] = useState("");
  const [refundError, setRefundError] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);
  const [resumeState, setResumeState] = useState("");
  const [resumeError, setResumeError] = useState("");
  const [resumeBusy, setResumeBusy] = useState(false);
  const refund = async () => {
    if (!detail) return;
    setRefundBusy(true);
    setRefundError("");
    setRefundState("");
    try {
      const minor = toMinor(refundAmount, detail.currency);
      const result = await api.refund(detail.paymentId, minor, crypto.randomUUID());
      setRefundState(`Refund ${shortId(result.refundId)} · ${friendly(result.status)}`);
      setRefundAmount("");
      await queryClient.invalidateQueries();
    } catch (e) {
      setRefundError(asError(e));
    } finally {
      setRefundBusy(false);
    }
  };
  const resume = async () => {
    if (!detail) return;
    setResumeBusy(true);
    setResumeError("");
    setResumeState("");
    try {
      await api.create(
        {
          amountMinor: detail.amountMinor,
          currency: detail.currency,
          provider: detail.provider,
          scenario: detail.scenario,
        },
        detail.idempotencyKey,
      );
      setResumeState("Same operation key replayed. State refreshed from the API.");
      await queryClient.invalidateQueries();
    } catch (e) {
      setResumeError(asError(e));
    } finally {
      setResumeBusy(false);
    }
  };
  return (
    <Dialog.Root
      open={!!id}
      onOpenChange={(open) => {
        if (!open) {
          close();
          setRefundState("");
          setRefundError("");
          setResumeState("");
          setResumeError("");
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content detail-dialog">
          <div className="dialog-top">
            <div>
              <div className="eyebrow">PAYMENT RECORD</div>
              <Dialog.Title>{id ? shortId(id) : "Payment"}</Dialog.Title>
              <Dialog.Description>
                Operation state, processor attempts and posted journal.
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close">
              <X size={18} />
            </Dialog.Close>
          </div>
          {error ? (
            <ErrorState error={error} />
          ) : loading || !detail ? (
            <LoadingState label="Loading payment detail" />
          ) : (
            <div className="detail-scroll">
              <div className="detail-hero">
                <div>
                  <span>Amount</span>
                  <strong>{money(detail.amountMinor, detail.currency)}</strong>
                </div>
                <div className="hero-actions">
                  <Status value={detail.status} />
                  {["CREATED", "PROCESSING", "UNKNOWN"].includes(detail.status) && (
                    <button
                      className="button subtle"
                      onClick={() => void resume()}
                      disabled={resumeBusy}
                    >
                      {resumeBusy ? (
                        <CircleNotch className="spin" size={14} />
                      ) : (
                        <ArrowCounterClockwise size={14} />
                      )}
                      Resume same request
                    </button>
                  )}
                </div>
              </div>
              {(resumeError || resumeState) && (
                <div
                  className={
                    resumeError ? "form-error compact-error" : "form-pending compact-pending"
                  }
                >
                  {resumeError || resumeState}
                </div>
              )}
              <div className="detail-facts">
                <DetailFact label="Processor" value={friendly(detail.provider)} />
                <DetailFact label="Created" value={new Date(detail.createdAt).toLocaleString()} />
                <DetailFact label="Idempotency key" value={shortId(detail.idempotencyKey)} mono />
                <DetailFact
                  label="Processor reference"
                  value={detail.externalRef ? shortId(detail.externalRef) : "Not assigned"}
                  mono
                />
              </div>
              <section className="detail-section">
                <h3>Operation timeline</h3>
                <div className="detail-timeline">
                  {[
                    { name: "Payment created", date: detail.createdAt, done: true },
                    {
                      name: "Processor attempt",
                      date: detail.attempts[0]?.createdAt,
                      done: !!detail.attempts.length,
                    },
                    {
                      name: detail.status === "FAILED" ? "Processor declined" : "Processor result",
                      date: detail.attempts[0]?.updatedAt,
                      done: ["FAILED", "SUCCEEDED"].includes(detail.status),
                    },
                    {
                      name: "Ledger posted",
                      date: detail.journal?.createdAt,
                      done: !!detail.journal,
                    },
                  ].map((item, index) => (
                    <div className={`detail-step ${item.done ? "done" : ""}`} key={item.name}>
                      <span className="step-dot">
                        {item.done ? <CheckCircle size={14} weight="fill" /> : index + 1}
                      </span>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.date
                            ? new Date(item.date).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })
                            : "Waiting"}
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
              {detail.journal && (
                <section className="detail-section">
                  <div className="detail-section-heading">
                    <h3>Ledger journal</h3>
                    <span className="status status-good">
                      <span />
                      Balanced
                    </span>
                  </div>
                  <div className="journal-lines">
                    {detail.journal.entries.map((entry) => (
                      <div className="journal-line" key={entry.id}>
                        <span>
                          <strong>
                            {entry.account?.name?.replaceAll("_", " ") ?? shortId(entry.accountId)}
                          </strong>
                          <small>{entry.account?.type ?? "Account"}</small>
                        </span>
                        <span>
                          {BigInt(entry.debitMinor) ? (
                            <>
                              <small>DR</small>
                              {money(entry.debitMinor, detail.currency)}
                            </>
                          ) : (
                            <>
                              <small>CR</small>
                              {money(entry.creditMinor, detail.currency)}
                            </>
                          )}
                        </span>
                      </div>
                    ))}
                    <div className="journal-total">
                      <span>Debits = credits</span>
                      <strong>{money(detail.amountMinor, detail.currency)}</strong>
                    </div>
                  </div>
                </section>
              )}
              {detail.attempts.length > 0 && (
                <section className="detail-section">
                  <h3>Processor attempts</h3>
                  {detail.attempts.map((attempt) => (
                    <div className="attempt-row" key={attempt.id}>
                      <span>
                        <strong>{shortId(attempt.id)}</strong>
                        <small>
                          {attempt.invocations} invocation{attempt.invocations === 1 ? "" : "s"}
                        </small>
                      </span>
                      <Status value={attempt.status} />
                    </div>
                  ))}
                </section>
              )}
              {detail.status === "SUCCEEDED" && BigInt(detail.refundableMinor) > 0n && (
                <section className="detail-section refund-section">
                  <h3>Issue a refund</h3>
                  <div className="refund-row">
                    <label className="refund-input">
                      <span>{detail.currency}</span>
                      <input
                        inputMode="decimal"
                        placeholder={`Up to ${money(detail.refundableMinor, detail.currency, false)}`}
                        value={refundAmount}
                        onChange={(e) => setRefundAmount(e.target.value)}
                      />
                    </label>
                    <button
                      className="button subtle"
                      disabled={!refundAmount || refundBusy}
                      onClick={() => void refund()}
                    >
                      {refundBusy ? (
                        <CircleNotch className="spin" size={14} />
                      ) : (
                        <ArrowDownLeft size={14} />
                      )}
                      Refund
                    </button>
                  </div>
                  <small className="field-hint">
                    Remaining refundable: {money(detail.refundableMinor, detail.currency)}
                  </small>
                  {refundError && <div className="form-error compact-error">{refundError}</div>}
                  {refundState && <div className="form-pending compact-pending">{refundState}</div>}
                </section>
              )}
              {detail.events.length > 0 && (
                <section className="detail-section">
                  <h3>Outbox events</h3>
                  {detail.events.map((event) => (
                    <div className="attempt-row" key={event.id}>
                      <span>
                        <strong>{friendly(event.eventType)}</strong>
                        <small>{shortId(event.id)}</small>
                      </span>
                      <Status value={event.status} />
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function DetailFact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="detail-fact">
      <span>{label}</span>
      <strong className={mono ? "mono" : ""}>{value}</strong>
    </div>
  );
}

function ConnectionDialog({
  open,
  onOpenChange,
  mode,
  onConnect,
  onDemo,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "demo" | "live";
  onConnect: (token: string) => void;
  onDemo: () => void;
}) {
  const [token, setToken] = useState("");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content connection-dialog">
          <div className="dialog-top">
            <div>
              <div className="eyebrow">WORKSPACE</div>
              <Dialog.Title>Connection settings</Dialog.Title>
              <Dialog.Description>
                Choose sample data or connect to your local API.
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="connection-options">
            <button
              className={`connection-option ${mode === "demo" ? "chosen" : ""}`}
              onClick={onDemo}
            >
              <span className="workspace-indicator demo" />
              <span>
                <strong>Sample workspace</strong>
                <small>Local, seeded operations. Safe to explore.</small>
              </span>
              {mode === "demo" && <CheckCircle size={17} />}
            </button>
            <div className={`connection-option ${mode === "live" ? "chosen" : ""}`}>
              <span className="workspace-indicator live" />
              <span>
                <strong>Live API</strong>
                <small>Connect with a short-lived operator JWT.</small>
              </span>
              {mode === "live" && <CheckCircle size={17} />}
            </div>
          </div>
          <label className="token-label">
            Operator bearer token
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="eyJ..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <small>
              The token is stored in this browser tab’s session storage and sent only to the
              same-origin API proxy.
            </small>
          </label>
          <div className="dialog-actions">
            <Dialog.Close className="button subtle">Close</Dialog.Close>
            <button
              className="button primary"
              disabled={!token.trim()}
              onClick={() => {
                onConnect(token.trim());
                setToken("");
              }}
            >
              Connect API <ArrowUpRight size={14} />
            </button>
          </div>
          <p className="connection-help">
            Create a local token with the command in the repository README. The API must be running
            on port 3000; set <code>API_ORIGIN</code> to change the proxy target.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
