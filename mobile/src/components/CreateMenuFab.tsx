import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState, type ComponentType } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconClient, IconInvoice, IconJob, IconQuote } from '@/components/EntityIcons';
import { ENTITY_COLOR } from '@/lib/entityColors';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

// The floating "+" create menu shared by the technician Home and the rep
// Schedule (Horaire): New job / client / quote / invoice — nothing else.
//
// Presentation: a full-screen overlay rather than a popover list. The page
// stays visible behind a native blur + a light dark scrim, and the four
// actions sit in a 2x2 grid of large circles, each filled with its entity
// colour from the desktop Client Hub (see @/lib/entityColors).
//
// The "+" is the only close affordance: it spins 45deg into an "x" while the
// menu is open. Because the overlay is a Modal (own window, own coordinate
// space) the trigger underneath it cannot be reused, so we measure the real
// button and redraw an identical one at those exact window coordinates — the
// rotation then reads as one continuous button rather than a swap.

type CreateOption = {
  key: string;
  label: string;
  color: string;
  Icon: ComponentType<{ color: string; size?: number }>;
  route: string;
};

// Circles stay thumb-sized on the smallest iPhone and grow a little on the
// big ones; two columns always fit with room to breathe.
const SCREEN_W = Dimensions.get('window').width;
const CIRCLE = SCREEN_W < 380 ? 78 : 88;
const COL_GAP = 28;
const CELL = CIRCLE + 40;

const OPEN_MS = 220;
const CLOSE_MS = 150;

// Fallback anchor if the trigger cannot be measured (matches `bottom-6 right-6`).
const FAB_SIZE = 56;
const FAB_EDGE = 24;

function ActionCircle({ option, onPress }: { option: CreateOption; onPress: () => void }) {
  const { Icon, label, color } = option;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => ({
        width: CELL,
        alignItems: 'center',
        opacity: pressed ? 0.75 : 1,
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      <View
        style={{
          width: CIRCLE,
          height: CIRCLE,
          borderRadius: CIRCLE / 2,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
          // A hairline lifts the darker circles (navy, bordeaux, near-black)
          // off the dimmed backdrop without tinting the colour itself.
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: 'rgba(255,255,255,0.22)',
          shadowColor: '#000',
          shadowOpacity: 0.3,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        <Icon color="#FFFFFF" size={Math.round(CIRCLE * 0.38)} />
      </View>
      <Text
        numberOfLines={2}
        style={{
          marginTop: 12,
          textAlign: 'center',
          fontSize: 14,
          fontWeight: '600',
          color: '#FFFFFF',
          textShadowColor: 'rgba(0,0,0,0.35)',
          textShadowRadius: 6,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function CreateMenuFab() {
  const { can, canSeePricing } = usePermissions();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  // `visible` mounts the modal; `progress` drives the open/close animation and
  // unmounts it only once the closing tween has finished.
  const [visible, setVisible] = useState(false);
  const progress = useSharedValue(0);
  // Guards a double tap during the 150ms close tween from pushing twice.
  const closing = useRef(false);
  // Window-space rect of the real trigger, so the in-overlay "+" lands on it.
  const fabRef = useRef<View>(null);
  const [fabRect, setFabRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Entity icons are the web's lucide glyphs (EntityHubHeader), not SF Symbols,
  // and each circle carries that section's colour from the desktop Client Hub.
  const options: CreateOption[] = [];
  if (can('jobs.create'))
    options.push({ key: 'job', label: t.mobileHome.newJob, color: ENTITY_COLOR.job, Icon: IconJob, route: '/(app)/jobs/new' });
  if (can('clients.create'))
    options.push({ key: 'client', label: t.mobileHome.newClient, color: ENTITY_COLOR.client, Icon: IconClient, route: '/(app)/clients/new' });
  if (can('quotes.create') || canSeePricing)
    options.push({ key: 'quote', label: t.mobileHome.newQuote, color: ENTITY_COLOR.quote, Icon: IconQuote, route: '/(app)/quotes/new' });
  if (can('invoices.create') || canSeePricing)
    options.push({ key: 'invoice', label: t.mobileHome.newInvoice, color: ENTITY_COLOR.invoice, Icon: IconInvoice, route: '/(app)/invoices/new' });

  const openMenu = () => {
    const node = fabRef.current;
    if (!node) {
      setVisible(true);
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      setFabRect({ x, y, w, h });
      setVisible(true);
    });
  };

  // Fades in once the modal is actually on screen, so no frame is dropped.
  const onShown = () => {
    closing.current = false;
    progress.value = withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
  };

  // Unmount only after the closing tween, then hand off to the picked route —
  // the very same screens as before, no duplicated form or workflow.
  const finishClose = (route?: string) => {
    setVisible(false);
    if (route) router.push(route as any);
  };

  const close = (route?: string) => {
    if (closing.current) return;
    closing.current = true;
    progress.value = withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(finishClose)(route);
    });
  };

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  // 0deg "+" → 45deg "x", tied to the same tween as the backdrop.
  const fabSpinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 45}deg` }],
  }));
  const gridStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { scale: 0.92 + 0.08 * progress.value },
      { translateY: (1 - progress.value) * 18 },
    ],
  }));

  if (options.length === 0) return null;

  return (
    <>
      <Pressable
        ref={fabRef}
        onPress={openMenu}
        accessibilityRole="button"
        className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-ink"
        style={{ shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}
      >
        <SymbolView name="plus" tintColor="#FFFFFF" size={24} resizeMode="scaleAspectFit" />
      </Pressable>

      {/* Full-screen modal: it blocks scrolling and taps on the page behind,
          and `onRequestClose` wires up the Android hardware back button. */}
      <Modal
        visible={visible}
        transparent
        animationType="none"
        statusBarTranslucent
        onShow={onShown}
        onRequestClose={() => close()}
      >
        {/* Blurred + dimmed backdrop; tapping it closes the menu. */}
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <BlurView intensity={34} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(9,9,11,0.28)' }]} />
        </Animated.View>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel={t.common.close}
          onPress={() => close()}
        />

        <Animated.View
          pointerEvents="box-none"
          style={[
            {
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingTop: insets.top + 24,
              paddingBottom: insets.bottom + 32,
              paddingHorizontal: 24,
            },
            gridStyle,
          ]}
        >
          <View
            pointerEvents="box-none"
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'center',
              width: CELL * 2 + COL_GAP,
              columnGap: COL_GAP,
              rowGap: 36,
            }}
          >
            {options.map((o) => (
              <ActionCircle key={o.key} option={o} onPress={() => close(o.route)} />
            ))}
          </View>
        </Animated.View>

        {/* The trigger, redrawn over the overlay at its real screen position:
            same size, same colour, spun 45deg so the "+" reads as an "x". */}
        <Animated.View
          style={[
            fabRect
              ? { position: 'absolute', left: fabRect.x, top: fabRect.y, width: fabRect.w, height: fabRect.h }
              : { position: 'absolute', right: FAB_EDGE, bottom: insets.bottom + FAB_EDGE, width: FAB_SIZE, height: FAB_SIZE },
            fabSpinStyle,
          ]}
        >
          <Pressable
            onPress={() => close()}
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              backgroundColor: '#171717',
              shadowColor: '#000',
              shadowOpacity: 0.2,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 },
            }}
          >
            <SymbolView name="plus" tintColor="#FFFFFF" size={24} resizeMode="scaleAspectFit" />
          </Pressable>
        </Animated.View>
      </Modal>
    </>
  );
}
