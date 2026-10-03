import type { ColorValue, ViewProps } from 'react-native';

type Props = ViewProps & {
  color?: ColorValue;
};

export function LibavView(_props: Props): never {
  throw new Error(
    "'react-native-libav' is only supported on native platforms."
  );
}
