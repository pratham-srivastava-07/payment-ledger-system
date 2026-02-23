import app from "./app";
import { PORT } from "./config/index.config";

app.listen(PORT, () => {
  console.log(`
🚀 Event-Driven Payment Reconciliation & Ledger System started!
📡 Server running on port ${PORT}
    `);
});
