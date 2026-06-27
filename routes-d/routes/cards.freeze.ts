import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type CardStatus = "active" | "frozen" | "closed";

type CardRecord = {
  cardId: string;
  userId: string;
  status: CardStatus;
  maskedNumber: string;
  expiryMonth: string;
  expiryYear: string;
  currency: string;
  frozenAt?: string;
};

type AuditEvent = {
  cardId: string;
  action: "freeze";
  performedBy: string;
  timestamp: string;
};

const cardStore = new Map<string, CardRecord>();
const auditEvents: AuditEvent[] = [];

export function __resetCardStore(): void {
  cardStore.clear();
  auditEvents.length = 0;
}

export function __seedCard(card: CardRecord): void {
  cardStore.set(card.cardId, card);
}

export function __getCard(cardId: string): CardRecord | undefined {
  return cardStore.get(cardId);
}

export function __getAuditEvents(): AuditEvent[] {
  return auditEvents;
}

const FRESH_AUTH_SECONDS = 300;

router.post(
  "/cards/:id/freeze",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.headers["x-user-id"] as string | undefined;
      const authTimestamp = req.headers["x-auth-timestamp"] as string | undefined;

      const cardId = id?.trim();
      if (!cardId) {
        sendError(res, "INVALID_CARD_ID", "cardId is required", 400);
        return;
      }

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      if (!authTimestamp) {
        sendError(res, "REAUTH_REQUIRED", "Fresh authentication required", 403);
        return;
      }

      const authTime = parseInt(authTimestamp, 10);
      if (isNaN(authTime) || Date.now() - authTime > FRESH_AUTH_SECONDS * 1000) {
        sendError(res, "REAUTH_REQUIRED", "Fresh authentication required", 403);
        return;
      }

      const card = cardStore.get(cardId);

      if (!card) {
        sendError(res, "CARD_NOT_FOUND", "Card not found", 404);
        return;
      }

      if (card.userId !== userId) {
        sendError(res, "FORBIDDEN", "You do not have permission to freeze this card", 403);
        return;
      }

      if (card.status === "frozen") {
        sendError(res, "ALREADY_FROZEN", "Card is already frozen", 409);
        return;
      }

      if (card.status === "closed") {
        sendError(res, "CARD_CLOSED", "Cannot freeze a closed card", 409);
        return;
      }

      const now = new Date().toISOString();
      card.status = "frozen";
      card.frozenAt = now;

      auditEvents.push({ cardId, action: "freeze", performedBy: userId, timestamp: now });

      return res.status(200).json({
        success: true,
        data: { cardId, status: "frozen", frozenAt: now },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
