import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

// The RnTrace TurboModule (C++: cpp/module/RnTraceModule). Synchronous: each call is a JSI call into librntrace.
export interface Spec extends TurboModule {
  begin(name: string): void;
  end(): void;
  asyncBegin(name: string, id: number): void;
  asyncEnd(id: number): void;
  instant(name: string): void;
  counter(name: string, value: number): void;
  isEnabled(): boolean;
  isAvailable(): boolean;
  isRecording(): boolean;
  // In-process recording: '' as path for the default (the app's cache directory). Returns the file, or '' if it
  // could not start.
  start(path: string, categories: string, bufferKb: number): string;
  stop(): boolean;
}

export default TurboModuleRegistry.get<Spec>('RnTrace');
