import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type TxStatus = "pending" | "settled" | "declined" | "refunded";

type CardTransaction = {
  txId: string;
  cardId: string;
  amount: number;
  currency: string;
  status: TxStatus;
  merchant: string;
  createdAt: string;
};

const txStore = new Map<string, CardTransaction[]>();

export function __resetTxStore(): void {
  txStore.clear();
}

export function __seedTransaction(tx: CardTransaction): void {
  const list = txStore.get(tx.cardId) ?? [];
  list.push(tx);
  txStore.set(tx.cardId, list);
}

export function __getTxStore(): Map<string, CardTransaction[]> {
  return txStore;
}

router.get(
  "/cards/:id/transactions",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.headers["x-user-id"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      const { status, from, to, page = "1", limit = "20" } = req.query;

      const pageNum = parseInt(String(page), 10);
      const limitNum = parseInt(String(limit), 10);

      if (isNaN(pageNum) || pageNum < 1) {
        sendError(res, "INVALID_PAGE", "page must be a positive integer", 400);
        return;
      }

      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        sendError(res, "INVALID_LIMIT", "limit must be between 1 and 100", 400);
        return;
      }

      let fromDate: Date | undefined;
      let toDate: Date | undefined;

      if (from) {
        fromDate = new Date(String(from));
        if (isNaN(fromDate.getTime())) {
          sendError(res, "INVALID_DATE", "from must be a valid ISO date", 400);
          return;
        }
      }

      if (to) {
        toDate = new Date(String(to));
        if (isNaN(toDate.getTime())) {
          sendError(res, "INVALID_DATE", "to must be a valid ISO date", 400);
          return;
        }
      }

      let txs = txStore.get(id) ?? [];

      if (status && typeof status === "string") {
        txs = txs.filter((tx) => tx.status === status.trim());
      }

      if (fromDate) {
        txs = txs.filter((tx) => new Date(tx.createdAt) >= fromDate!);
      }

      if (toDate) {
        txs = txs.filter((tx) => new Date(tx.createdAt) <= toDate!);
      }

      // Sort by recency (newest first)
      txs = [...txs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      const total = txs.length;
      const offset = (pageNum - 1) * limitNum;
      const paged = txs.slice(offset, offset + limitNum);

      return res.status(200).json({
        success: true,
        data: paged,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          hasNext: offset + limitNum < total,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
