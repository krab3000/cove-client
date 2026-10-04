import { Image, View } from 'react-native';
import type { SpriteCue, SpriteSheet } from '../api/cove';

/**
 * One cell of Cove's sprite sheet (the frames its generate task takes across a video), filling width × height:
 * the sheet is scaled so the cell covers the box and centred in it. The sheet loads once and is shared by every
 * cell; moving to another cell only moves the image.
 */
export function SpriteCell({
  sprite,
  cue,
  width,
  height,
  onLoad,
}: {
  sprite: SpriteSheet;
  cue: SpriteCue;
  width: number;
  height: number;
  onLoad?: () => void;
}) {
  const scale = Math.max(width / cue.w, height / cue.h);
  const left = (width - cue.w * scale) / 2 - cue.x * scale;
  const top = (height - cue.h * scale) / 2 - cue.y * scale;
  return (
    <View style={{ width, height, overflow: 'hidden' }}>
      <Image
        source={{ uri: sprite.url }}
        onLoad={onLoad}
        style={{
          position: 'absolute',
          left,
          top,
          width: sprite.width * scale,
          height: sprite.height * scale,
        }}
      />
    </View>
  );
}
