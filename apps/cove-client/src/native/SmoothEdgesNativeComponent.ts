import { codegenNativeComponent, type ViewProps } from 'react-native';

export interface NativeProps extends ViewProps {}

// An empty view (implemented in windows/CoveClient/SmoothEdges.cpp) that turns on anti-aliased edges for the
// composition tree it is mounted in: React Native Windows rounds corners (borderRadius) with composition clips, which
// are drawn aliased unless the visual tree's BorderMode is Soft. Mount one per root: the app's and each Modal's.
export default codegenNativeComponent<NativeProps>('SmoothEdges');
