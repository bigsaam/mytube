import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';

export function GET() {
	// Touch the DB so the healthcheck fails loudly if the file is unavailable.
	db.run(sql`SELECT 1`);
	return json({ ok: true, service: 'mytube' });
}
