import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import cardTxRouter, {
  __resetTxStore,
  __seedTransaction,
} from "../routes/cards.transactions.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cardTxRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const USER = "user-abc";
const CARD = "card-001";

describe("GET /cards/:id/transactions", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetTxStore();
  });

  // --- empty ---

  it("returns empty list when card has no transactions", async () => {
    const res = await request(app)
      .get(`/cards/${CARD}/transactions`)
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  // --- basic list ---

  it("returns transactions for the card", async () => {
    __seedTransaction({ txId: "tx-1", cardId: CARD, amount: 50, currency: "USD", status: "settled", merchant: "Acme", createdAt: "2024-01-10T10:00:00Z" });

    const res = await request(app)
      .get(`/cards/${CARD}/transactions`)
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].txId).toBe("tx-1");
  });

  // --- status filter ---

  it("filters by status=settled", async () => {
    __seedTransaction({ txId: "tx-1", cardId: CARD, amount: 50, currency: "USD", status: "settled", merchant: "Acme", createdAt: "2024-01-10T10:00:00Z" });
    __seedTransaction({ txId: "tx-2", cardId: CARD, amount: 20, currency: "USD", status: "declined", merchant: "Bobs", createdAt: "2024-01-11T10:00:00Z" });

    const res = await request(app)
      .get(`/cards/${CARD}/transactions?status=settled`)
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].txId).toBe("tx-1");
  });

  // --- date range filter ---

  it("filters by from date", async () => {
    __seedTransaction({ txId: "tx-old", cardId: CARD, amount: 10, currency: "USD", status: "settled", merchant: "X", createdAt: "2024-01-01T00:00:00Z" });
    __seedTransaction({ txId: "tx-new", cardId: CARD, amount: 20, currency: "USD", status: "settled", merchant: "Y", createdAt: "2024-03-01T00:00:00Z" });

    const res = await request(app)
      .get(`/cards/${CARD}/transactions?from=2024-02-01`)
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].txId).toBe("tx-new");
  });

  it("filters by to date", async () => {
    __seedTransaction({ txId: "tx-old", cardId: CARD, amount: 10, currency: "USD", status: "settled", merchant: "X", createdAt: "2024-01-01T00:00:00Z" });
    __seedTransaction({ txId: "tx-new", cardId: CARD, amount: 20, currency: "USD", status: "settled", merchant: "Y", createdAt: "2024-03-01T00:00:00Z" });

    const res = await request(app)
      .get(`/cards/${CARD}/transactions?to=2024-02-01`)
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].txId).toBe("tx-old");
  });

  // --- sort order ---

  it("returns transactions sorted by recency (newest first)", async () => {
    __seedTransaction({ txId: "tx-jan", cardId: CARD, amount: 10, currency: "USD", status: "settled", merchant: "A", createdAt: "2024-01-01T00:00:00Z" });
    __seedTransaction({ txId: "tx-mar", cardId: CARD, amount: 30, currency: "USD", status: "settled", merchant: "C", createdAt: "2024-03-01T00:00:00Z" });
    __seedTransaction({ txId: "tx-feb", cardId: CARD, amount: 20, currency: "USD", status: "settled", merchant: "B", createdAt: "2024-02-01T00:00:00Z" });

    const res = await request(app)
      .get(`/cards/${CARD}/transactions`)
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((t: { txId: string }) => t.txId);
    expect(ids).toEqual(["tx-mar", "tx-feb", "tx-jan"]);
  });

  // --- pagination ---

  it("paginates correctly", async () => {
    for (let i = 1; i <= 5; i++) {
      __seedTransaction({ txId: `tx-${i}`, cardId: CARD, amount: i * 10, currency: "USD", status: "settled", merchant: `M${i}`, createdAt: `2024-01-0${i}T00:00:00Z` });
    }

    const res = await request(app)
      .get(`/cards/${CARD}/transactions?page=2&limit=2`)
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.page).toBe(2);
    expect(res.body.pagination.total).toBe(5);
    expect(res.body.pagination.hasNext).toBe(true);
  });

  it("returns hasNext=false on the last page", async () => {
    for (let i = 1; i <= 3; i++) {
      __seedTransaction({ txId: `tx-${i}`, cardId: CARD, amount: i * 10, currency: "USD", status: "settled", merchant: `M${i}`, createdAt: `2024-01-0${i}T00:00:00Z` });
    }

    const res = await request(app)
      .get(`/cards/${CARD}/transactions?page=2&limit=2`)
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    expect(res.body.pagination.hasNext).toBe(false);
  });

  // --- validation ---

  it("rejects unauthenticated request", async () => {
    const res = await request(app).get(`/cards/${CARD}/transactions`);

    expect(res.status).toBe(401);
  });

  it("rejects invalid page", async () => {
    const res = await request(app)
      .get(`/cards/${CARD}/transactions?page=0`)
      .set("x-user-id", USER);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAGE");
  });

  it("rejects invalid limit", async () => {
    const res = await request(app)
      .get(`/cards/${CARD}/transactions?limit=999`)
      .set("x-user-id", USER);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LIMIT");
  });

  it("rejects invalid from date", async () => {
    const res = await request(app)
      .get(`/cards/${CARD}/transactions?from=not-a-date`)
      .set("x-user-id", USER);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DATE");
  });
});
