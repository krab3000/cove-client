import {
  codegenNativeComponent,
  type CodegenTypes,
  type ViewProps,
} from 'react-native';

export type WheelEvent = Readonly<{
  /** Mouse wheel delta: 120 per notch, positive away from the user (scroll up). */
  delta: CodegenTypes.Double;
}>;

export interface NativeProps extends ViewProps {
  /** The wheel turned over this view; the event no longer reaches the ScrollView around it. */
  onWheel?: CodegenTypes.DirectEventHandler<WheelEvent>;
}

// A plain container (implemented in windows/CoveClient/WheelCapture.cpp) that takes vertical mouse wheel events
// before the ScrollView around it, so the app can scroll by its own step: React Native Windows scrolls a fixed
// 120 px per notch and does not pass wheel events to JS.
export default codegenNativeComponent<NativeProps>('WheelCapture');
