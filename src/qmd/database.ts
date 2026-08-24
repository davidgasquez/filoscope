type SqliteDatabase = {
  pragma(sql: string): unknown;
  pragma(sql: string, options: { simple: true }): unknown;
};

export function validateSqliteDatabase(databaseValue: unknown, subject: string): void {
  const database = databaseValue as SqliteDatabase;
  const [checkpoint] = database.pragma("wal_checkpoint(TRUNCATE)") as [{ busy: number }];
  if (checkpoint.busy !== 0) throw new Error(`${subject} is busy and could not be checkpointed`);

  const integrity = database.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") {
    throw new Error(`${subject} integrity check failed: ${String(integrity)}`);
  }
}
