import { PaginatedSlots, Slot as LegacySlot } from "../types.js";
import { getSlotsCount, getSlotsPage } from "../repositories/slotRepository.js";
import { InMemoryCache } from "../cache/inMemoryCache.js";

// ─── SlotService (class-based, used by slotsRoute / update-slot / slots-cache tests) ──

export const SLOT_LIST_CACHE_TTL_MS = 60_000;

export interface Slot {
  id: number;
  professional: string;
  startTime: number | string;
  endTime: number | string;
  createdAt: string;
  updatedAt: string;
}

export class SlotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlotValidationError";
  }
}

export class SlotNotFoundError extends Error {
  constructor(id: number) {
    super(`Slot ${id} was not found`);
    this.name = "SlotNotFoundError";
  }
}

export class SlotService {
  private store: Slot[] = [];
  private nextId = 1;
  private readonly cache: InMemoryCache<Slot[]> | null;
  private readonly now: () => Date;

  constructor(
    cacheOrNow?: InMemoryCache<Slot[]> | (() => Date),
    now?: () => Date,
  ) {
    if (typeof cacheOrNow === "function") {
      // slot-service.test.ts: new SlotService(now)
      this.cache = null;
      this.now = cacheOrNow;
    } else {
      // slotService.test.ts: new SlotService(cache, now)
      this.cache = cacheOrNow ?? new InMemoryCache({ ttlMs: SLOT_LIST_CACHE_TTL_MS });
      this.now = now ?? (() => new Date());
    }
  }

  listSlots(): Slot[] | Promise<{ slots: Slot[]; cache: "hit" | "miss" }> {
    if (!this.cache) {
      // Synchronous path (slot-service.test.ts)
      return this.store.map((s) => ({ ...s }));
    }
    // Async path with cache (slotService.test.ts)
    return this.cache.getOrLoad("slots:list:all", async () =>
      this.store.map((s) => ({ ...s })),
    ).then((result) => ({
      slots: result.value,
      cache: result.source === "cache" ? "hit" as const : "miss" as const,
    }));
  }

  createSlot(input: { professional: string; startTime: number | string; endTime: number | string }): Slot {
    if (!input.professional || input.professional.trim().length === 0) {
      throw new SlotValidationError("professional must be a non-empty string");
    }
    // Only validate numeric ordering when both values are numbers
    if (typeof input.startTime === "number" && typeof input.endTime === "number") {
      if (!Number.isFinite(input.startTime) || !Number.isFinite(input.endTime)) {
        throw new SlotValidationError("startTime and endTime must be finite numbers");
      }
      if (input.endTime <= input.startTime) {
        throw new SlotValidationError("endTime must be greater than startTime");
      }
    }
    const ts = this.now().toISOString();
    const slot: Slot = {
      id: this.nextId++,
      professional: input.professional.trim(),
      startTime: input.startTime,
      endTime: input.endTime,
      createdAt: ts,
      updatedAt: ts,
    };
    this.store.push(slot);
    this.cache?.invalidate("slots:list:all");
    return slot;
  }

  updateSlot(id: number, patch: { professional?: string; startTime?: number | string; endTime?: number | string }): Slot {
    if (!patch || typeof patch !== "object") {
      throw new SlotValidationError("update payload must be an object");
    }
    if (patch.professional !== undefined && typeof patch.professional !== "string") {
      throw new SlotValidationError("professional must be a string");
    }
    if ((patch.startTime !== undefined && typeof patch.startTime === "number" && !Number.isFinite(patch.startTime)) ||
        (patch.endTime !== undefined && typeof patch.endTime === "number" && !Number.isFinite(patch.endTime))) {
      throw new SlotValidationError("startTime and endTime must be finite numbers");
    }
    const idx = this.store.findIndex((s) => s.id === id);
    if (idx === -1) throw new SlotNotFoundError(id);
    const existing = this.store[idx];
    const updated: Slot = {
      ...existing,
      ...(patch.professional !== undefined && { professional: patch.professional.trim() }),
      ...(patch.startTime !== undefined && { startTime: patch.startTime }),
      ...(patch.endTime !== undefined && { endTime: patch.endTime }),
      updatedAt: this.now().toISOString(),
    };
    if (typeof updated.endTime === "number" && typeof updated.startTime === "number" &&
        updated.endTime <= updated.startTime) {
      throw new SlotValidationError("endTime must be greater than startTime");
    }
    this.store[idx] = updated;
    this.cache?.invalidate("slots:list:all");
    return { ...updated };
  }

  deleteSlot(id: number): void {
    const idx = this.store.findIndex((s) => s.id === id);
    if (idx === -1) throw new SlotNotFoundError(id);
    this.store.splice(idx, 1);
    this.cache?.invalidate("slots:list:all");
  }

  findById(id: number): Slot | undefined {
    return this.store.find((s) => s.id === id);
  }

  reset(): void {
    this.store = [];
    this.nextId = 1;
    this.cache?.invalidate("slots:list:all");
  }
}

export const slotService = new SlotService();

const MAX_LIMIT = 100;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

export interface PaginationOptions {
  page?: number;
  limit?: number;
}

export interface SlotRepositoryInterface {
  getSlotsCount: () => Promise<number>;
  getSlotsPage: (offset: number, limit: number) => Promise<LegacySlot[]>;
}

function sanitizeSlot(slot: LegacySlot): LegacySlot {
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

  const total = await repository.getSlotsCount();
  const offset = (page - 1) * limit;

  if (offset >= total && total > 0) {
    // requested page beyond number of items results empty data, keep page
    return {
      data: [],
      page,
      limit,
      total,
    };
  }

  const rawSlots = await repository.getSlotsPage(offset, limit);
  const data = rawSlots.map(sanitizeSlot);

  return {
    data,
    page,
    limit,
    total,
  };
};

export const listSlotsWithFailure = async (options: PaginationOptions): Promise<PaginatedSlots> => {
  // wrapper for simulating DB failures in tests (not used in production)
  return listSlots(options);
};
