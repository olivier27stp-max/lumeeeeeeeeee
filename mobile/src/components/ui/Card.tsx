import { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

type Props = {
  children: ReactNode;
  onPress?: () => void;
  className?: string;
};

export function Card({ children, onPress, className }: Props) {
  const base = `bg-white rounded-2xl border border-surface-border p-4 ${className ?? ''}`;
  if (onPress) {
    return (
      <Pressable onPress={onPress} className={`${base} active:bg-surface-alt`}>
        {children}
      </Pressable>
    );
  }
  return <View className={base}>{children}</View>;
}
