import { forwardRef } from 'react';
import { Text, TextInput, TextInputProps, View } from 'react-native';

type Props = TextInputProps & {
  label?: string;
  error?: string | null;
};

export const Input = forwardRef<TextInput, Props>(function Input(
  { label, error, className, ...rest },
  ref,
) {
  return (
    <View className="gap-1.5">
      {label ? <Text className="text-sm font-medium text-ink-muted">{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor="#94A3B8"
        className={`h-12 rounded-2xl border border-surface-border bg-white px-4 text-base text-ink ${error ? 'border-status-late' : ''} ${className ?? ''}`}
        {...rest}
      />
      {error ? <Text className="text-xs text-status-late">{error}</Text> : null}
    </View>
  );
});
