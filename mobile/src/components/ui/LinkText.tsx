import { Linking, Text } from 'react-native';

const URL_RE = /(https?:\/\/[^\s]+)/g;

/**
 * Renders a string but turns any http(s) URL into a tappable link. React Native
 * <Text> does NOT auto-linkify, so a quote/pay link in a message bubble would be
 * dead text without this.
 */
export function LinkText({
  text,
  className,
  linkClassName = 'underline',
}: {
  text: string;
  className?: string;
  linkClassName?: string;
}) {
  const parts = text.split(URL_RE);
  return (
    <Text className={className}>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <Text
            key={i}
            className={linkClassName}
            onPress={() => Linking.openURL(part.replace(/[).,]+$/, '')).catch(() => {})}
          >
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}
