import { useEffect } from 'react';
import NativeRnTrace from './NativeRnTrace';

/**
 * Trace events from JavaScript into the process's one tracer (librntrace, Perfetto), next to the native libraries'
 * (react-native-mpv) and, in a system trace, the OS's. All events go in the "app" category, on the JS thread's
 * track (async spans on tracks of their own).
 *
 * Each call is one synchronous JSI call (about a microsecond): fine around user actions, screens and loads, not per
 * frame or list item. In builds without the backend (release, by default) every call does nothing.
 */

const module = NativeRnTrace;

// Async span ids get their own range: native code uses object addresses as track ids.
const ASYNC_BASE = 0x4a5300000000;
let nextAsync = 1;

/** Whether the "app" category is being recorded now (check before building costly names). */
export function isEnabled(): boolean {
  return module?.isEnabled() ?? false;
}

/** Whether tracing is built in (false in no-op builds and where the module is missing). */
export function isAvailable(): boolean {
  return module?.isAvailable() ?? false;
}

/** A span on the JS thread until end(); spans nest. */
export function begin(name: string): void {
  module?.begin(name);
}

export function end(): void {
  module?.end();
}

/** A span that may outlive the current call (across awaits, between components). Returns its id for asyncEnd. */
export function asyncBegin(name: string): number {
  const id = ASYNC_BASE + nextAsync++;
  module?.asyncBegin(name, id);
  return id;
}

export function asyncEnd(id: number): void {
  module?.asyncEnd(id);
}

export function instant(name: string): void {
  module?.instant(name);
}

export function counter(name: string, value: number): void {
  module?.counter(name, value);
}

/** fn inside a span named name. */
export function trace<T>(name: string, fn: () => T): T {
  module?.begin(name);
  try {
    return fn();
  } finally {
    module?.end();
  }
}

/** The promise's lifetime as an async span. */
export async function traceAsync<T>(name: string, promise: Promise<T>): Promise<T> {
  const id = asyncBegin(name);
  try {
    return await promise;
  } finally {
    asyncEnd(id);
  }
}

/** A component's mounted lifetime as an async span. */
export function useTraceMount(name: string): void {
  useEffect(() => {
    const id = asyncBegin(name);
    return () => asyncEnd(id);
  }, [name]);
}

/**
 * Records in-process (no adb needed): categories like 'app,mpv' (default: all), into path (default: a file in
 * the app's cache directory). Returns the file, or null if it could not start (no backend, one already running).
 */
export function startRecording(options?: { path?: string; categories?: string; bufferKb?: number }): string | null {
  const path = module?.start(options?.path ?? '', options?.categories ?? '', options?.bufferKb ?? 0) ?? '';
  return path || null;
}

/** Stops the in-process recording and writes its file; false if none was running. */
export function stopRecording(): boolean {
  return module?.stop() ?? false;
}

export function isRecording(): boolean {
  return module?.isRecording() ?? false;
}
