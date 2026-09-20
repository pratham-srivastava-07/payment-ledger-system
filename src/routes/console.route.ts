import { Router } from "express";
import { ConsoleService } from "../services/ConsoleService.service";
import { identifier } from "../domain/operation";
import { DomainError } from "../errors/domainError";

export const consoleRouter = Router();
const service = new ConsoleService();

function query(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new DomainError("INVALID_QUERY", "Query values must be strings");
  return value;
}

consoleRouter.get("/overview", async (req, res) => {
  res.json(
    await service.overview(res.locals.subject, query(req.query.currency), query(req.query.days)),
  );
});
consoleRouter.get("/payments", async (req, res) => {
  res.json(
    await service.listPayments(res.locals.subject, {
      currency: query(req.query.currency),
      status: query(req.query.status),
      search: query(req.query.search),
      page: query(req.query.page),
      days: query(req.query.days),
    }),
  );
});
consoleRouter.get("/payments/:id", async (req, res) => {
  res.json(await service.detail(res.locals.subject, identifier(req.params.id, "paymentId")));
});
consoleRouter.get("/accounts", async (req, res) => {
  res.json(await service.accounts(query(req.query.currency)));
});
consoleRouter.get("/capabilities", (_req, res) => {
  res.json({
    mockScenarios: process.env.ALLOW_MOCK_SCENARIOS === "true",
    transport: "PostgreSQL inbox",
  });
});
