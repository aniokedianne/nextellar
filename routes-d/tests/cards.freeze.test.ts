import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import cardFreezeRouter, {
  __resetCardStore,
  __seedCard,
  __getCard,
  __getAuditEvents,
} from "../routes/cards.freeze.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cardFreezeRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const USER = "user-abc";
const OTHER = "user-xyz";
const CARD_ID = "card-001";
const FRESH_TS = () => String(Date.now());

describe("POST /cards/:id/freeze", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetCardStore();
  });

  it("freezes an active card successfully", async () => {
    __seedCard({ cardId: CARD_ID, userId: USER, status: "active", maskedNumber: "****1234", expiryMonth: "12", expiryYear: "2028", currency: "USD" });

    const res = await request(app)
      .post(`/cards/${CARD_ID}/freeze`)
      .set("x-user-id", USER)
      .set("x-auth-timestamp", FRESH_TS());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("frozen");
    expect(res.body.data.frozenAt).toBeDefined();

    expect(__getCard(CARD_ID)?.status).toBe("frozen");
  });

  it("emits an audit event on successful freeze", async () => {
    __seedCard({ cardId: CARD_ID, userId: USER, status: "active", maskedNumber: "****1234", expiryMonth: "12", expiryYear: "2028", currency: "USD" });

    await request(app)
      .post(`/cards/${CARD_ID}/freeze`)
      .set("x-user-id", USER)
      .set("x-auth-timestamp", FRESH_TS());

    const events = __getAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("freeze");
    expect(events[0].cardId).toBe(CARD_ID);
    expect(events[0].performedBy).toBe(USER);
  });

  it("rejects when card is already frozen", async () => {
    __seedCard({ cardId: CARD_ID, userId: USER, status: "frozen", maskedNumber: "****1234", expiryMonth: "12", expiryYear: "2028", currency: "USD" });

    const res = await request(app)
      .post(`/cards/${CARD_ID}/freeze`)
      .set("x-user-id", USER)
      .set("x-auth-timestamp", FRESH_TS());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_FROZEN");
  });

  it("rejects when card belongs to a different user", async () => {
    __seedCard({ cardId: CARD_ID, userId: USER, status: "active", maskedNumber: "****1234", expiryMonth: "12", expiryYear: "2028", currency: "USD" });

    const res = await request(app)
      .post(`/cards/${CARD_ID}/freeze`)
      .set("x-user-id", OTHER)
      .set("x-auth-timestamp", FRESH_TS());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects when card is not found", async () => {
    const res = await request(app)
      .post("/cards/nonexistent/freeze")
      .set("x-user-id", USER)
      .set("x-auth-timestamp", FRESH_TS());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CARD_NOT_FOUND");
  });

  it("rejects without x-user-id header", async () => {
    const res = await request(app)
      .post(`/cards/${CARD_ID}/freeze`)
      .set("x-auth-timestamp", FRESH_TS());

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects without x-auth-timestamp (fresh auth required)", async () => {
    __seedCard({ cardId: CARD_ID, userId: USER, status: "active", maskedNumber: "****1234", expiryMonth: "12", expiryYear: "2028", currency: "USD" });

    const res = await request(app)
      .post(`/cards/${CARD_ID}/freeze`)
      .set("x-user-id", USER);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("REAUTH_REQUIRED");
  });

  it("rejects with a stale auth timestamp", async () => {
    __seedCard({ cardId: CARD_ID, userId: USER, status: "active", maskedNumber: "****1234", expiryMonth: "12", expiryYear: "2028", currency: "USD" });

    const staleTs = String(Date.now() - 10 * 60 * 1000); // 10 min ago

    const res = await request(app)
      .post(`/cards/${CARD_ID}/freeze`)
      .set("x-user-id", USER)
      .set("x-auth-timestamp", staleTs);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("REAUTH_REQUIRED");
  });
});
