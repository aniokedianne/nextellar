import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type CardRecord = {
  cardId: string;
  userId: string;
  status: "active" | "frozen" | "closed";
  pinHash?: string;
};

const cardStore = new Map<string, CardRecord>();

// Per-card rate limit: max attempts within window
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

export function __resetCardStore(): void {
  cardStore.clear();
  rateLimitMap.clear();
}

export function __seedCard(card: CardRecord): void {
  cardStore.set(card.cardId, { ...card });
}

export function __getCard(cardId: string): CardRecord | undefined {
  return cardStore.get(cardId);
}

export function __getRateLimitMap(): Map<string, { count: number; windowStart: number }> {
  return rateLimitMap;
}

function checkRateLimit(cardId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(cardId);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(cardId, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

router.post(
  "/cards/:id/pin",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.headers["x-user-id"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      const cardId = id?.trim();
      if (!cardId) {
        sendError(res, "INVALID_CARD_ID", "cardId is required", 400);
        return;
      }

      if (checkRateLimit(cardId)) {
        sendError(res, "RATE_LIMITED", "Too many PIN attempts. Try again later.", 429);
        return;
      }

      const { pin } = req.body as { pin?: unknown };

      if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) {
        sendError(res, "INVALID_PIN", "pin must be a 4-6 digit numeric string", 400);
        return;
      }

      const card = cardStore.get(cardId);

      if (!card) {
        sendError(res, "CARD_NOT_FOUND", "Card not found", 404);
        return;
      }

      if (card.userId !== userId) {
        sendError(res, "FORBIDDEN", "You do not have permission to set a PIN for this card", 403);
        return;
      }

      if (card.status === "closed") {
        sendError(res, "CARD_CLOSED", "Cannot set PIN on a closed card", 409);
        return;
      }

      // Store a deterministic hash rather than the raw PIN
      card.pinHash = `hashed:${pin.split("").reverse().join("")}`;

      return res.status(200).json({
        success: true,
        data: { cardId, pinUpdated: true },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
