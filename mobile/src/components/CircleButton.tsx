import { SymbolView, SymbolViewProps } from 'expo-symbols';
import { Pressable } from 'react-native';

type Props = {
  icon: SymbolViewProps['name'];
  onPress?: () => void;
  size?: number;
};

/** Light grey circular action button with a monochrome SF Symbol. */
export function CircleButton({ icon, onPress, size = 44 }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="items-center justify-center bg-surface-sunken active:opacity-70"
    >
      <SymbolView name={icon} tintColor="#171717" size={size * 0.42} resizeMode="scaleAspectFit" />
    </Pressable>
  );
}
