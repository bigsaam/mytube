import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { channelSlug } from './slug';

/**
 * Paths under MEDIA_ROOT. The DB stores paths RELATIVE to MEDIA_ROOT so the
 * library survives a volume remount at a different absolute path. Every
 * relative→absolute resolution is guarded against traversal.
 */

export function videoDirAbs(name: string | null, channelId: string | null, videoId: string): string {
	return path.join(config.mediaRoot, channelSlug(name, channelId), videoId);
}

export function toRelative(absPath: string): string {
	return path.relative(config.mediaRoot, absPath).split(path.sep).join('/');
}

/** Resolve a stored relative path to an absolute one, refusing to escape root. */
export function toAbsolute(relPath: string | null | undefined): string | null {
	if (!relPath) return null;
	const abs = path.resolve(config.mediaRoot, relPath);
	const root = path.resolve(config.mediaRoot);
	if (abs !== root && !abs.startsWith(root + path.sep)) return null; // traversal
	return abs;
}

export function fileSize(absPath: string | null): number | null {
	if (!absPath) return null;
	try {
		return fs.statSync(absPath).size;
	} catch {
		return null;
	}
}

/** Recursively delete a video's on-disk directory. Never touches the DB. */
export function deleteVideoDir(relVideoPath: string | null): void {
	const abs = toAbsolute(relVideoPath);
	if (!abs) return;
	const dir = path.dirname(abs);
	// Only delete inside MEDIA_ROOT, and only a leaf video dir.
	const root = path.resolve(config.mediaRoot);
	if (dir.startsWith(root + path.sep)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/** Directory size in bytes (recursive), for the storage dashboard. */
export function dirSize(absDir: string): number {
	let total = 0;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(absDir, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const e of entries) {
		const p = path.join(absDir, e.name);
		if (e.isDirectory()) total += dirSize(p);
		else {
			try {
				total += fs.statSync(p).size;
			} catch {
				/* ignore */
			}
		}
	}
	return total;
}
