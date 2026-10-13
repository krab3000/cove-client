import { Image } from 'react-native';

const ICON = require('../assets/cove-icon.png');

/** Cove's icon (coveicon.ico from the Cove repository): the brand mark before "Cove", and Settings → About. */
export function CoveMark({ size = 22 }: { size?: number }) {
  return (
    <Image
      source={ICON}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel="Cove"
    />
  );
}
