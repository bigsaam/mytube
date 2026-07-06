import { EventEmitter } from 'node:events';

/**
 * Process-wide event bus. Background workers emit progress/state changes here;
 * SSE endpoints subscribe to push them to the browser (Phase 5). Keeping it in
 * one module avoids import cycles between the worker and the routes.
 */
export interface DownloadUpdate {
	id?: number;
	videoId?: string;
	percent?: number;
	speed?: string | null;
	eta?: string | null;
	stage?: string;
	done?: boolean;
	error?: boolean;
}

class Bus extends EventEmitter {
	emit(event: 'download:update', payload: DownloadUpdate): boolean;
	emit(event: string, payload: unknown): boolean {
		return super.emit(event, payload);
	}
	on(event: 'download:update', listener: (payload: DownloadUpdate) => void): this;
	on(event: string, listener: (payload: never) => void): this {
		return super.on(event, listener as (payload: unknown) => void);
	}
	off(event: 'download:update', listener: (payload: DownloadUpdate) => void): this;
	off(event: string, listener: (payload: never) => void): this {
		return super.off(event, listener as (payload: unknown) => void);
	}
}

const globalForBus = globalThis as unknown as { __haystackBus?: Bus };
export const bus = globalForBus.__haystackBus ?? new Bus();
bus.setMaxListeners(100);
if (import.meta.env?.DEV) globalForBus.__haystackBus = bus;
