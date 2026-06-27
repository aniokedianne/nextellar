import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import cardPinRouter, {
  __resetCardStore,
  __seedCard,
  __getCard,
  __getRateLimitMap,
} from "../routes/cards.pin.set.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cardPinRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const USER = "user-abc";
const OTHER = "user-xyz";
const CARD_ID = "card-001";

describe("POST /cards/:id/pin", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetCardStore();
  });

  it("sets a valid 4-digit PIN successfully", async () => {
    __seedCard({ cardId: CARD_ID, userId: USER, status: "active" });

    const res = await request(app)
      .post(`/cards/${CARD_ID}/pin`)
      .set("x-user-id", USER)
      .send({ pin: "1234" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pinUpdated).toBe(true);
  });

  it("sets a valid 6-digit PIN successfully", async () => {
    __seedCard({ cardId: CARD_ID, userId: USER, status: "active" });

    const res = await request(app)
      .post(`/cards/${CARD_ID}/pin`)
      .set("x-user-id", USER)
      .send({ pin: "654321" });

    expect(res.status).toBe(200);
    expect(res.body.data.pinUpdated).toBe(true);
  });

  it("does not expose raw PIN — pinHash is a one-way transform", async () => {
    __seedCard({ cardId: CARD_ID, userId: USER, status: "active" });

    await request(app)
      .post(`/cards/${CARD_ID}/pin`)
      .set("x-user-id", USER)
      .send({ pin: "9999" });

    const card = __getCard(CARD_ID);
    expect(card?.pinHash).toBeDefined();
    expect(card?.pinHash).not.toBe("9999");
  });

  it("response body never contains the raw PIN", async () => {
    __seedCard({ cardId: CARD_ID, userId: USER, status: "active" });

    const res = await request(app)
      .post(`/cards/${CARD_ID}/pin`)
      .set("x-user-id", USER)
      .send({ pin: "1234" });

    expect(JSON.stringify(res.body)).not.toContain("1234");
  });

  it("rejects rate-limited requests after 3 attempts", async () => {
    __seedCard({ cardId: CARD_ID, userId: USER, status: "active" });

    // Exhaust the rate limit window with invalid PINs to avoid resetting card
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/cards/${CARD_ID}/pin`)
        .set("x-user-id", USER)
        .send({ pin: "1234" });
    }

    const res = await request(app)
      .post(`/cards/${CARD_ID}/pin`)
      .set("x-user-id", USER)
      .send({ pin: "5678" });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
  });

  it("rejects when card belongs to a different user", async () => {
    __seedCard({ cardId: CARD_ID, userId: USER, status: "active" });

    const res = await request(app)
      .post(`/cards/${CARD_ID}/pin`)
      .set("x-user-id", OTHER)
      .send({ pin: "1234" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects when card is not found", async () => {
    const res = await request(app)
      .post("/cards/nonexistent/pin")
      .set("x-user-id", USER)
      .send({ pin: "1234" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CARD_NOT_FOUND");
  });

  it("rejects unauthenticated request", async () => {
    const res = await request(app)
      .post(`/cards/${CARD_ID}/pin`)
      .send({ pin: "1234" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects PIN that is not numeric", async () => {
    __seedCard({ cardId: CARD_ID, userId: USER, status: "active" });

    const res = await request(app)
      .post(`/cards/${CARD_ID}/pin`)
      .set("x-user-id", USER)
      .send({ pin: "abcd" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PIN");
  });

  it("rejects PIN shorter than 4 digits", async () => {
    __seedCard({ cardId: CARD_ID, userId: USER, status: "active" });

    const res = await request(app)
      .post(`/cards/${CARD_ID}/pin`)
      .set("x-user-id", USER)
      .send({ pin: "12" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PIN");
  });
});
