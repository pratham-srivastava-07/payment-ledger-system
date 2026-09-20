const { PaymentService } = require('../dist/services/PaymentService.service');
const { MockPaymentAdapter } = require('../dist/adapters/mockPaymentAdapter');

class CrashAfterCharge extends MockPaymentAdapter {
  async charge(data) {
    await super.charge(data);
    process.exit(73);
  }
}
const service = new PaymentService({ adapter: (provider) => new CrashAfterCharge(provider) });
service.processPayment({ paymentId: process.argv[2], amountMinor: '100', currency: 'USD', provider: 'STRIPE' }, process.argv[2], process.argv[3])
  .catch((error) => { console.error(error); process.exit(1); });
