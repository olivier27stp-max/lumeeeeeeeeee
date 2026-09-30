import { forwardRef } from 'react';
import { Text, TextInput, TextInputProps, View } from 'react-native';

import { useThemeLumi } from '@/lib/lumi/theme';

type Props = TextInputProps & {
  label?: string;
  error?: string | null;
};

export const Input = forwardRef<TextInput, Props>(function Input(
  { label, error, className, ...rest },
  ref,
) {
  // `placeholderTextColor` est une PROP, pas une classe : elle ne peut pas venir
  // d'un jeton Tailwind, il faut la valeur du thème.
  const { c } = useThemeLumi();
  return (
    <View className="gap-1.5">
      {label ? (
        <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{label}</Text>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={c.texteTenu}
        className={`h-12 rounded-xl border border-surface-border bg-surface-sunken px-4 text-base text-ink ${error ? 'border-status-late' : ''} ${className ?? ''}`}
        {...rest}
      />
      {error ? <Text className="text-xs text-status-late">{error}</Text> : null}
    </View>
  );
});
