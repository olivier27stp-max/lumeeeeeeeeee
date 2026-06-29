import { ActivityIndicator, Pressable, Text } from 'react-native';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
};

const containerByVariant: Record<Variant, string> = {
  primary: 'bg-brand active:bg-brand-600',
  secondary: 'bg-white border border-surface-border active:bg-surface-alt',
  ghost: 'bg-transparent active:bg-surface-alt',
  danger: 'bg-status-late active:opacity-90',
};

const textByVariant: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-ink',
  ghost: 'text-brand',
  danger: 'text-white',
};

export function Button({ title, onPress, variant = 'primary', loading, disabled }: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      className={`h-12 rounded-2xl items-center justify-center px-5 ${containerByVariant[variant]} ${isDisabled ? 'opacity-50' : ''}`}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? '#fff' : '#171717'} />
      ) : (
        <Text className={`text-base font-semibold ${textByVariant[variant]}`}>{title}</Text>
      )}
    </Pressable>
  );
}
