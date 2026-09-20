import express from "express";
import cors from "cors";
import { router } from "./routes";
import { errorHandler } from "./middlewares/errorHandler";
import swaggerUi from "swagger-ui-express";
import { specs } from "./config/swagger";

const app = express();

app.set("json replacer", (_key: string, value: unknown) => typeof value === "bigint" ? value.toString() : value);

app.use(express.json());
app.use(cors());

// Swagger Documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

app.use("/api/v1", router);
app.use(errorHandler);

export default app;
