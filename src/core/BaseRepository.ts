import { QueryResultRow } from "pg";
import { query } from "../db/query";
import { ApiError } from "./ApiError";

export interface ListResult<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

export interface RepositoryOptions {
  /**
   * Restrict which columns may be selected/filtered/sorted. When omitted, every
   * column of the table (discovered from the catalog) is allowed.
   */
  columns?: readonly string[];
  /** Override the detected primary key (rarely needed). */
  primaryKey?: string;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

/**
 * Generic read-only data access for a single table.
 *
 * Column names and the primary key are discovered from the PostgreSQL catalog
 * on first use and cached, so a module only needs to name its table. SQL
 * identifiers (used in sort/filter) are validated against that discovered set
 * and double-quoted; all user-supplied *values* are bound as parameters
 * ($1, $2, ...). This keeps the generic query builder safe from SQL injection.
 */
export class BaseRepository<T extends QueryResultRow = QueryResultRow> {
  protected readonly table: string;
  private readonly explicitColumns: Set<string> | null;
  private readonly primaryKeyOverride: string | null;

  private columns: Set<string> | null = null;
  private primaryKey = "id";
  private loadPromise: Promise<void> | null = null;

  constructor(table: string, options: RepositoryOptions = {}) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`Invalid table name: ${table}`);
    }
    this.table = table;
    this.explicitColumns = options.columns ? new Set(options.columns) : null;
    this.primaryKeyOverride = options.primaryKey ?? null;
  }

  /** Loads the column allowlist and primary key from the catalog once, then caches. */
  private async ensureLoaded(): Promise<void> {
    if (this.columns) return;
    if (!this.loadPromise) this.loadPromise = this.loadSchema();
    await this.loadPromise;
  }

  private async loadSchema(): Promise<void> {
    const cols = await query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [this.table]
    );
    if (cols.length === 0) {
      throw ApiError.internal(`Table "${this.table}" not found in the database`);
    }
    const columnNames = cols.map((c) => c.column_name);

    let pk = this.primaryKeyOverride;
    if (!pk) {
      const pkRows = await query<{ column_name: string }>(
        `SELECT kcu.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = 'public'
            AND tc.table_name = $1
          ORDER BY kcu.ordinal_position
          LIMIT 1`,
        [this.table]
      );
      pk = pkRows[0]?.column_name ?? "id";
    }
    this.primaryKey = pk;

    const allowed = this.explicitColumns
      ? columnNames.filter((c) => this.explicitColumns!.has(c))
      : columnNames;
    this.columns = new Set(allowed);
    this.columns.add(pk); // always allow the primary key
  }

  /** Validates an identifier against the allowlist and returns it double-quoted. */
  private quoteIdentifier(name: string): string {
    if (!this.columns?.has(name)) {
      throw ApiError.badRequest(`Unknown column: ${name}`);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw ApiError.badRequest(`Invalid column name: ${name}`);
    }
    return `"${name}"`;
  }

  /** Parses & clamps pagination/sort/filter inputs from a query-string object. */
  private parseListOptions(raw: Record<string, unknown>) {
    const limitRaw = Number(raw.limit);
    const offsetRaw = Number(raw.offset);

    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const offset = Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw), 0) : 0;

    const sort = typeof raw.sort === "string" ? raw.sort : undefined;
    const order = String(raw.order).toUpperCase() === "DESC" ? "DESC" : "ASC";

    // Any remaining query keys that match real columns become equality filters.
    const reserved = new Set(["limit", "offset", "sort", "order"]);
    const filters: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (reserved.has(key)) continue;
      if (this.columns?.has(key)) filters[key] = value;
    }

    return { limit, offset, sort, order: order as "ASC" | "DESC", filters };
  }

  /** Builds the shared WHERE clause from equality filters. */
  private buildWhere(filters: Record<string, unknown>, params: unknown[]): string {
    const clauses: string[] = [];
    for (const [column, value] of Object.entries(filters)) {
      params.push(value);
      clauses.push(`${this.quoteIdentifier(column)} = $${params.length}`);
    }
    return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  }

  async findAll(rawQuery: Record<string, unknown> = {}): Promise<ListResult<T>> {
    await this.ensureLoaded();
    const opts = this.parseListOptions(rawQuery);

    const params: unknown[] = [];
    const where = this.buildWhere(opts.filters, params);

    const sortColumn = opts.sort ? this.quoteIdentifier(opts.sort) : this.quoteIdentifier(this.primaryKey);
    const orderBy = `ORDER BY ${sortColumn} ${opts.order}`;

    params.push(opts.limit);
    const limitPlaceholder = `$${params.length}`;
    params.push(opts.offset);
    const offsetPlaceholder = `$${params.length}`;

    const sql = `
      SELECT * FROM "${this.table}"
      ${where}
      ${orderBy}
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `;

    const [data, total] = await Promise.all([
      query<T>(sql, params),
      this.count(opts.filters),
    ]);

    return {
      data,
      pagination: { total, limit: opts.limit, offset: opts.offset },
    };
  }

  async count(filters: Record<string, unknown> = {}): Promise<number> {
    await this.ensureLoaded();
    const params: unknown[] = [];
    const where = this.buildWhere(filters, params);
    const rows = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "${this.table}" ${where}`,
      params
    );
    return Number(rows[0]?.count ?? 0);
  }

  async findById(id: string | number): Promise<T | null> {
    await this.ensureLoaded();
    const rows = await query<T>(
      `SELECT * FROM "${this.table}" WHERE ${this.quoteIdentifier(this.primaryKey)} = $1`,
      [id]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /** Builds "col1", "col2", ... / $1, $2, ... pairs from a data object, validating each column. */
  private buildColumnValueLists(data: Record<string, unknown>): {
    columns: string[];
    placeholders: string[];
    values: unknown[];
  } {
    const columns: string[] = [];
    const placeholders: string[] = [];
    const values: unknown[] = [];

    for (const [column, value] of Object.entries(data)) {
      values.push(value);
      columns.push(this.quoteIdentifier(column));
      placeholders.push(`$${values.length}`);
    }

    return { columns, placeholders, values };
  }

  /** Inserts a row. Returns the inserted row. */
  async insert(data: Record<string, unknown>): Promise<T> {
    await this.ensureLoaded();
    if (Object.keys(data).length === 0) {
      throw ApiError.badRequest("No data provided to insert");
    }
    const { columns, placeholders, values } = this.buildColumnValueLists(data);

    const rows = await query<T>(
      `INSERT INTO "${this.table}" (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       RETURNING *`,
      values
    );
    return rows[0];
  }

  /** Updates a row by primary key. Returns the updated row (null if it doesn't exist). */
  async update(id: string | number, data: Record<string, unknown>): Promise<T | null> {
    await this.ensureLoaded();
    if (Object.keys(data).length === 0) {
      throw ApiError.badRequest("No data provided to update");
    }
    const { columns, placeholders, values } = this.buildColumnValueLists(data);
    const setClause = columns.map((col, i) => `${col} = ${placeholders[i]}`).join(", ");

    values.push(id);
    const rows = await query<T>(
      `UPDATE "${this.table}"
          SET ${setClause}
        WHERE ${this.quoteIdentifier(this.primaryKey)} = $${values.length}
      RETURNING *`,
      values
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /** Inserts a row, or updates it on primary-key conflict. Returns the resulting row. */
  async upsert(data: Record<string, unknown>): Promise<T> {
    await this.ensureLoaded();
    const { columns, placeholders, values } = this.buildColumnValueLists(data);
    const pk = this.quoteIdentifier(this.primaryKey);
    const updateClause = columns
      .filter((col) => col !== pk)
      .map((col) => `${col} = EXCLUDED.${col}`)
      .join(", ");

    const rows = await query<T>(
      `INSERT INTO "${this.table}" (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       ON CONFLICT (${pk}) DO UPDATE SET ${updateClause}
       RETURNING *`,
      values
    );
    return rows[0];
  }

  /** Deletes a row by primary key. Returns true if a row was deleted. */
  async remove(id: string | number): Promise<boolean> {
    await this.ensureLoaded();
    const rows = await query(
      `DELETE FROM "${this.table}" WHERE ${this.quoteIdentifier(this.primaryKey)} = $1 RETURNING ${this.quoteIdentifier(this.primaryKey)}`,
      [id]
    );
    return rows.length > 0;
  }
}
