import { Pressable, StyleSheet } from 'react-native';
import { Icon, type IconName } from '../../../ui/Icon';
import { overVideo, roundRadius } from '../../../theme/tokens';

export function PlayButton({
  size,
  icon,
  onPress,
}: {
  size: number;
  icon: IconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={icon === 'pause' ? 'Pause' : 'Play'}
      style={({ pressed }) => [
        styles.play,
        { width: size, height: size, borderRadius: roundRadius(size) },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} fill size={size * 0.44} color={overVideo.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  play: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,15,24,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(233,233,237,0.35)',
  },
  pressed: { opacity: 0.6 },
});
