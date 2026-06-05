import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';

import {
  Bounds,
  createHouseAt,
  listHousesInBounds,
  STATUS_COLOR,
} from '@/lib/api/fieldSales';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/usePermissions';

const DEFAULT_REGION: Region = {
  latitude: 45.5019,
  longitude: -73.5674, // Montreal
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

function regionToBounds(r: Region): Bounds {
  return {
    minLat: r.latitude - r.latitudeDelta / 2,
    maxLat: r.latitude + r.latitudeDelta / 2,
    minLng: r.longitude - r.longitudeDelta / 2,
    maxLng: r.longitude + r.longitudeDelta / 2,
  };
}

export default function D2DMap() {
  const { session } = useAuth();
  const { orgId } = usePermissions();
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [ready, setReady] = useState(false);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({});
          if (alive) {
            setRegion((r) => ({
              ...r,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            }));
          }
        }
      } catch {
        // keep default region
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const { data: houses, refetch } = useQuery({
    queryKey: ['d2d', 'houses', orgId, region.latitude.toFixed(3), region.longitude.toFixed(3)],
    queryFn: () => listHousesInBounds(regionToBounds(region)),
    enabled: !!orgId && ready,
  });

  const onLongPress = (lat: number, lng: number) => {
    if (!orgId || !session?.user.id) return;
    Alert.alert('New pin', 'Drop a house pin here?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Drop pin',
        onPress: async () => {
          try {
            const house = await createHouseAt({
              orgId,
              userId: session.user.id,
              lat,
              lng,
            });
            refetch();
            router.push(`/(app)/d2d-house/${house.id}`);
          } catch (e) {
            Alert.alert('Could not create pin', (e as Error).message);
          }
        },
      },
    ]);
  };

  return (
    <View className="flex-1">
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={DEFAULT_REGION}
        region={region}
        onRegionChangeComplete={setRegion}
        showsUserLocation
        showsMyLocationButton
        onLongPress={(e) =>
          onLongPress(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)
        }
      >
        {(houses ?? [])
          .filter((h) => h.lat != null && h.lng != null)
          .map((h) => (
            <Marker
              key={h.id}
              coordinate={{ latitude: h.lat as number, longitude: h.lng as number }}
              onPress={() => router.push(`/(app)/d2d-house/${h.id}`)}
            >
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: STATUS_COLOR[h.current_status] ?? '#3B82F6',
                  borderWidth: 2,
                  borderColor: 'white',
                }}
              />
            </Marker>
          ))}
      </MapView>

      <View className="absolute top-14 left-5 right-5 rounded-xl bg-white/90 px-4 py-2 shadow">
        <Text className="text-sm font-medium text-ink">
          {houses?.length ?? 0} houses · long-press to drop a pin
        </Text>
      </View>

      {!ready ? (
        <View className="absolute inset-0 items-center justify-center bg-white/60">
          <ActivityIndicator color="#208AEF" />
        </View>
      ) : null}
    </View>
  );
}
