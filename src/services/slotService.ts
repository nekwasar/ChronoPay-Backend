import { PaginatedSlots } from "../types.js";
import { getSlotsCount, getSlotsPage } from "../repositories/slotRepository.js";

// Internal Slot type for SlotService
export interface Slot {
  id: number;
  professional: string;
  startTime: number;
  endTime: number;
  createdAt?: string;
  _internalNote?: string;
}

const MAX_LIMIT = 100;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

export const SLOT_LIST_CACHE_TTL_MS = 60000; // 60 seconds

export class SlotNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlotNotFoundError";
  }
}

export class SlotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlotValidationError";
  }
}

export interface PaginationOptions {
  page?: number;
  limit?: number;
}

export interface SlotRepositoryInterface {
  getSlotsCount: () => Promise<number>;
  getSlotsPage: (offset: number, limit: number) => Promise<any[]>;
}

function sanitizeSlot(slot: any): any {
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

export class SlotService {
  private slots: Map<number, Slot> = new Map();
  private nextId = 1;
  private timeProvider: () => Date;
  private cache: any;

  constructor(cache?: any, timeProvider: () => Date = () => new Date()) {
    this.cache = cache;
    this.timeProvider = timeProvider;
  }

  createSlot(data: { professional: string; startTime: number; endTime: number }): Slot {
    if (!data.professional || typeof data.professional !== "string" || data.professional.trim() === "") {
      throw new SlotValidationError("professional must be a non-empty string");
    }
    if (typeof data.startTime !== "number" || typeof data.endTime !== "number" || 
        !Number.isFinite(data.startTime) || !Number.isFinite(data.endTime)) {
      throw new SlotValidationError("startTime and endTime must be finite numbers");
    }
    if (data.endTime <= data.startTime) {
      throw new SlotValidationError("End time must be after start time");
    }

    const slot: Slot = {
      id: this.nextId++,
      professional: data.professional.trim(),
      startTime: data.startTime,
      endTime: data.endTime,
      createdAt: this.timeProvider().toISOString(),
    };

    this.slots.set(slot.id, slot);
    
    // Invalidate cache
    if (this.cache) {
      this.cache.delete("slots:all");
    }
    
    return { ...slot };
  }

  async listSlots(): Promise<{ slots: Slot[]; cache: "hit" | "miss" }> {
    if (this.cache) {
      const cached = this.cache.get("slots:all");
      if (cached !== undefined) {
        return { slots: JSON.parse(JSON.stringify(cached)), cache: "hit" };
      }
    }

    const slots = Array.from(this.slots.values()).map(slot => ({ ...slot }));
    
    if (this.cache) {
      this.cache.set("slots:all", slots);
    }
    
    return { slots: JSON.parse(JSON.stringify(slots)), cache: "miss" };
  }

  getSlot(id: number): Slot {
    const slot = this.slots.get(id);
    if (!slot) {
      throw new SlotNotFoundError(`Slot ${id} not found`);
    }
    return { ...slot };
  }

  updateSlot(id: number, data: Partial<{ professional: string; startTime: number; endTime: number }>): Slot {
    const slot = this.slots.get(id);
    if (!slot) {
      throw new SlotNotFoundError(`Slot ${id} not found`);
    }

    if (data.professional !== undefined && typeof data.professional !== "string") {
      throw new SlotValidationError("Professional must be a string");
    }
    if (data.startTime !== undefined && typeof data.startTime !== "number") {
      throw new SlotValidationError("Start time must be a number");
    }
    if (data.endTime !== undefined && typeof data.endTime !== "number") {
      throw new SlotValidationError("End time must be a number");
    }

    const updated = { ...slot, ...data };
    if (updated.endTime <= updated.startTime) {
      throw new SlotValidationError("End time must be after start time");
    }

    this.slots.set(id, updated);
    
    // Invalidate cache
    if (this.cache) {
      this.cache.delete("slots:all");
    }
    
    return { ...updated };
  }

  deleteSlot(id: number): void {
    if (!this.slots.has(id)) {
      throw new SlotNotFoundError(`Slot ${id} not found`);
    }
    this.slots.delete(id);
    
    // Invalidate cache
    if (this.cache) {
      this.cache.delete("slots:all");
    }
  }

  reset(): void {
    this.slots.clear();
    this.nextId = 1;
    if (this.cache) {
      this.cache.delete("slots:all");
    }
  }
}

export const slotService = new SlotService();
