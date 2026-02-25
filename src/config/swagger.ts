import swaggerJsdoc from "swagger-jsdoc";
import { PORT } from "./index.config";

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "Payment Ledger System API",
            version: "1.0.0",
            description: "API documentation for the Event-Driven Payment Reconciliation & Ledger System",
        },
        servers: [
            {
                url: `http://localhost:${PORT}/api/v1`,
                description: "Development server",
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                },
            },
        },
        security: [
            {
                bearerAuth: [],
            },
        ],
    },
    apis: ["./src/controllers/*.ts", "./src/routes/*.ts"],
};

export const specs = swaggerJsdoc(options);
