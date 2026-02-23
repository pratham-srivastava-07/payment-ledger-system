# Event-Driven Payment Reconciliation & Ledger System

A production-grade backend system for processing payments and maintaining an immutable double-entry ledger.

## 🏗️ Architecture

- **Event-Driven**: Uses Node.js `EventEmitter` for loose coupling.
- **Micro-patterns**: Adapter, Factory, and Singleton patterns.
- **Double-Entry Ledger**: Immutable transaction history with strict balancing.
- **Idempotency**: Prevents duplicate transaction processing.

## 🛠️ Tech Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express
- **ORM**: Prisma (PostgreSQL)
- **Quality**: ESLint + Prettier
- **Infrastructure**: Docker + Github Actions CI

## 🚀 Getting Started

### Local Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Setup Database**:
   Ensure PostgreSQL is running and update `DATABASE_URL` in `.env`.
   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```
3. **Run Application**:
   ```bash
   npm run dev
   ```

### Docker Setup

The easiest way to run the full stack (App + DB) is via Docker Compose:
```bash
docker-compose up --build
```

## 🧪 API Endpoints

- `POST /api/v1/payments`: Process a payment.
- `POST /api/v1/refunds`: Process a refund.
- `GET /api/v1/ledger/:accountId`: Fetch ledger entries and balance.
- `GET /api/v1/reconciliation/report`: Get latest reconciliation results.

## 👷 CI/CD

The project includes a GitHub Actions workflow (`.github/workflows/ci.yml`) that automatically runs on every push to `main`, performing:
- Formatting checks
- Linting
- Prisma generation
- Production build
