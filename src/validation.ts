export class ValidationError extends Error {
  code: string;
  field?: string;
  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.field = field;
  }
}

export function num(value: unknown, field: string, opts: { min?: number; max?: number; strict?: boolean } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError("INVALID_NUMBER", `${field} must be a finite number`, field);
  }
  if (opts.strict !== false && opts.min !== undefined && value <= opts.min) {
    throw new ValidationError("INVALID_RANGE", `${field} must be > ${opts.min}`, field);
  }
  if (opts.strict === false && opts.min !== undefined && value < opts.min) {
    throw new ValidationError("INVALID_RANGE", `${field} must be >= ${opts.min}`, field);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new ValidationError("INVALID_RANGE", `${field} must be <= ${opts.max}`, field);
  }
  return value;
}

export function str(value: unknown, field: string, maxLen = 200): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError("INVALID_STRING", `${field} must be a non-empty string`, field);
  }
  if (value.length > maxLen) {
    throw new ValidationError("INVALID_STRING", `${field} must be <= ${maxLen} chars`, field);
  }
  return value.trim();
}

export interface Page {
  limit: number;
  offset: number;
}

export function page(query: Record<string, unknown>): Page {
  const limitRaw = query.limit ?? 50;
  const offsetRaw = query.offset ?? 0;
  const limit = num(limitRaw, "limit", { min: 1, max: 200 });
  const offset = num(offsetRaw, "offset", { min: 0, strict: false });
  return { limit: Math.floor(limit), offset: Math.floor(offset) };
}
