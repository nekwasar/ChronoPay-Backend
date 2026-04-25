import { PaginatedSlots, Slot } from "../types.js";
import { getSlotsCount, getSlotsPage } from "../repositories/slotRepository.js";
import {
  recordSlotOperation,
  recordListLatency,
} from "../metrics/slotMetrics.js";

const MAX_LIMIT = 100;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

export interface PaginationOptions {
  page?: number;
  limit?: number;
}

export interface SlotRepositoryInterface {
  getSlotsCount: () => Promise<number>;
  getSlotsPage: (offset: number, limit: number) => Promise<Slot[]>;
}

function sanitizeSlot(slot: Slot): Slot {
  const { _internalNote, ...publicSlot } = slot;
  return publicSlot;
}

export const listSlots = async (
  options: PaginationOptions,
  repository: SlotRepositoryInterface = { getSlotsCount, getSlotsPage }
): Promise<PaginatedSlots> => {
  const page = options.page ?? DEFAULT_PAGE;
  const limit = options.limit ?? DEFAULT_LIMIT;

  if (!Number.isInteger(page) || page < 1) {
    throw new Error("Invalid page");
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Invalid limit");
  }

  if (limit > MAX_LIMIT) {
    throw new Error("Limit exceeds maximum allowed value");
  }

  const start = Date.now();
  try {
    const total = await repository.getSlotsCount();
    const offset = (page - 1) * limit;

    if (offset >= total && total > 0) {
      recordListLatency(Date.now() - start);
      recordSlotOperation("list", "success");
      return { data: [], page, limit, total };
    }

    const rawSlots = await repository.getSlotsPage(offset, limit);
    const data = rawSlots.map(sanitizeSlot);

    recordListLatency(Date.now() - start);
    recordSlotOperation("list", "success");

    return { data, page, limit, total };
  } catch (err) {
    recordListLatency(Date.now() - start);
    recordSlotOperation("list", "error");
    throw err;
  }
};

export const listSlotsWithFailure = async (options: PaginationOptions): Promise<PaginatedSlots> => {
  // wrapper for simulating DB failures in tests (not used in production)
  return listSlots(options);
};
