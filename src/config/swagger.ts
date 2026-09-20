import swaggerJsdoc from "swagger-jsdoc";

const minorAmount = {
  type: "string",
  pattern: "^[1-9][0-9]*$",
  example: "10000",
  description:
    "Positive integer minor units, at most 9223372036854775807. Safe integer JSON numbers are also accepted on input.",
};
const provider = { type: "string", enum: ["STRIPE", "PAYPAL", "RAZORPAY"] };
const currency = {
  type: "string",
  enum: ["USD", "INR", "EUR", "GBP", "JPY", "KWD"],
  default: "USD",
};
const scenario = {
  type: "string",
  enum: ["SUCCESS", "DECLINE", "TIMEOUT_BEFORE", "TIMEOUT_AFTER"],
  default: "SUCCESS",
  description: "Failure scenarios require ALLOW_MOCK_SCENARIOS=true.",
};
const keyHeader = {
  in: "header",
  name: "x-idempotency-key",
  required: true,
  schema: { type: "string", maxLength: 128 },
  description:
    "Scoped to JWT subject and payment/refund operation. Reuse the same key and payload after timeouts.",
};
const idParameter = { in: "path", name: "id", required: true, schema: { type: "string" } };
const operationResponses = {
  "200": {
    description: "Succeeded, or canonical replay of a succeeded operation",
    content: { "application/json": { schema: { $ref: "#/components/schemas/Operation" } } },
  },
  "202": {
    description: "Persisted operation is processing or awaiting recovery",
    content: { "application/json": { schema: { $ref: "#/components/schemas/Operation" } } },
  },
  "400": { description: "Invalid request; legacy amount field is not accepted" },
  "401": { description: "Invalid or missing Bearer token" },
  "403": { description: "Mock failure scenarios disabled" },
  "404": { description: "Original payment not found in caller scope" },
  "409": {
    description:
      "Conflicting key/payload, non-refundable payment, or insufficient refundable capacity",
  },
  "422": {
    description: "Definitive processor decline",
    content: { "application/json": { schema: { $ref: "#/components/schemas/Operation" } } },
  },
  "500": { description: "Internal failure; retry with the same key" },
};

// Definitions live in the compiled module so documentation also works in the runtime image.
export const specs = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Payment Ledger API",
      version: "2.0.0",
      description:
        "Mock payment operations with exact minor units, recoverable attempts and a transactional outbox. Tokens represent trusted operators; ledger/activity/outbox diagnostics are system-wide.",
    },
    servers: [{ url: "/api/v1" }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: {
        PaymentRequest: {
          type: "object",
          required: ["amountMinor", "provider"],
          properties: {
            paymentId: {
              type: "string",
              description:
                "Optional caller-assigned operation ID; distinct from the idempotency key.",
            },
            amountMinor: minorAmount,
            provider,
            currency,
            scenario,
          },
        },
        RefundRequest: {
          type: "object",
          required: ["paymentId", "amountMinor"],
          properties: {
            paymentId: { type: "string" },
            amountMinor: minorAmount,
            provider: {
              ...provider,
              description:
                "Optional; when supplied must match the original payment. Currency is inherited.",
            },
            scenario,
          },
        },
        Operation: {
          type: "object",
          properties: {
            paymentId: { type: "string" },
            refundId: { type: "string" },
            status: {
              type: "string",
              enum: ["CREATED", "PROCESSING", "UNKNOWN", "SUCCEEDED", "FAILED"],
            },
            amountMinor: minorAmount,
            currency,
            provider,
            transactionId: { type: "string", nullable: true },
            externalRef: { type: "string", nullable: true },
            error: { type: "string", nullable: true },
          },
        },
      },
    },
    paths: {
      "/payments": {
        post: {
          summary: "Create or replay a payment",
          parameters: [keyHeader],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/PaymentRequest" } },
            },
          },
          responses: operationResponses,
        },
      },
      "/refunds": {
        post: {
          summary: "Create or replay a partial/full refund",
          parameters: [keyHeader],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/RefundRequest" } },
            },
          },
          responses: operationResponses,
        },
      },
      "/payments/{id}": {
        get: {
          summary: "Read payment state in caller scope",
          parameters: [idParameter],
          responses: {
            "200": operationResponses["200"],
            "404": { description: "Payment not found" },
          },
        },
      },
      "/refunds/{id}": {
        get: {
          summary: "Read refund state in caller scope",
          parameters: [idParameter],
          responses: {
            "200": operationResponses["200"],
            "404": { description: "Refund not found" },
          },
        },
      },
      "/ledger/{accountId}": {
        get: {
          summary: "Read balance and newest 100 entries from one consistent snapshot",
          parameters: [{ ...idParameter, name: "accountId" }],
          responses: {
            "200": {
              description:
                "accountId, currency, balanceMinor (digit string), entries and limit. Provider accounts use debit-minus-credit; other current account types use credit-minus-debit.",
            },
            "404": { description: "Account not found" },
          },
        },
      },
      "/reconciliation/trigger": {
        post: {
          summary: "Compare current mock-provider and ledger balances",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["provider"],
                  properties: { provider, currency },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Balance report in minor units; this is not transaction-level settlement reconciliation",
            },
          },
        },
      },
      "/reconciliation/report": {
        get: {
          summary: "Read the latest balance report",
          responses: { "200": { description: "Latest report in minor units, or null" } },
        },
      },
      "/outbox": {
        get: {
          summary: "Read newest 100 outbox events and delivery state",
          responses: { "200": { description: "Outbox events" } },
        },
      },
      "/outbox/{id}/retry": {
        post: {
          summary: "Requeue a failed event with the same event ID",
          parameters: [idParameter],
          responses: {
            "202": { description: "Requeued" },
            "409": { description: "Event is missing or not failed" },
          },
        },
      },
      "/activity": {
        get: {
          summary: "Read newest 100 deduplicated system activity events",
          responses: { "200": { description: "Activity events" } },
        },
      },
    },
  },
  apis: [],
});
