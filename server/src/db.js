import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL tanımlı değil.');
    process.exit(1);
}

export const sql = postgres(process.env.DATABASE_URL, {
    max: 5,
    idle_timeout: 30,
    onnotice: () => {}
});

export async function migrate() {
    const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    await sql.unsafe(schema);
}
