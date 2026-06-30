import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, Text, View } from 'react-native';

import {
  attachmentDisplayUrl,
  capturePhoto,
  pickPhoto,
  removeAttachment,
  uploadJobPhoto,
} from '@/lib/api/jobPhotos';
import { SymbolView } from 'expo-symbols';
import { JobAttachment } from '@/types/db';

type Props = {
  jobId: string;
  orgId: string;
  userId?: string | null;
  attachments: JobAttachment[];
  editable?: boolean;
  /** Called after a successful upload so the parent can refetch the job. */
  onChange?: () => void;
};

const photoOnly = (a: JobAttachment) => a.kind !== 'signature';

export function JobPhotoGrid({ jobId, orgId, userId, attachments, editable = true, onChange }: Props) {
  const photos = attachments.filter(photoOnly);
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);

  const runUpload = async (uri: string) => {
    setUploading(true);
    try {
      await uploadJobPhoto({ jobId, orgId, uri, userId });
      onChange?.();
    } catch (e) {
      Alert.alert('Upload failed', (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const deletePhoto = (att: JobAttachment) => {
    Alert.alert('Supprimer la photo', 'Cette photo sera retirée du job. Continuer ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeAttachment(jobId, att.path ?? att.url);
            onChange?.();
          } catch (e) {
            Alert.alert('Photo', (e as Error).message);
          }
        },
      },
    ]);
  };

  const addPhoto = () => {
    Alert.alert('Add photo', undefined, [
      {
        text: 'Take photo',
        onPress: async () => {
          try {
            const img = await capturePhoto();
            if (img) await runUpload(img.uri);
          } catch (e) {
            Alert.alert('Camera', (e as Error).message);
          }
        },
      },
      {
        text: 'Choose from library',
        onPress: async () => {
          try {
            const img = await pickPhoto();
            if (img) await runUpload(img.uri);
          } catch (e) {
            Alert.alert('Library', (e as Error).message);
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-ink-muted uppercase">
          Photos {photos.length > 0 ? `(${photos.length})` : ''}
        </Text>
        {uploading ? <ActivityIndicator color="#171717" /> : null}
      </View>

      <View className="flex-row flex-wrap gap-2">
        {photos.map((att) => (
          <PhotoThumb
            key={att.path}
            att={att}
            onPress={(url) => setViewer(url)}
            onDelete={editable ? () => deletePhoto(att) : undefined}
          />
        ))}

        {editable ? (
          <Pressable
            onPress={addPhoto}
            disabled={uploading}
            className="h-24 w-24 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-surface-alt"
          >
            <Text className="text-3xl text-ink-muted">+</Text>
          </Pressable>
        ) : null}
      </View>

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable
          className="flex-1 items-center justify-center bg-black/90"
          onPress={() => setViewer(null)}
        >
          {viewer ? (
            <Image source={{ uri: viewer }} style={{ width: '92%', height: '70%' }} contentFit="contain" />
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function PhotoThumb({
  att,
  onPress,
  onDelete,
}: {
  att: JobAttachment;
  onPress: (fullUrl: string) => void;
  onDelete?: () => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    attachmentDisplayUrl(att, true).then((u) => {
      if (alive) setThumbUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [att]);

  return (
    <View className="relative">
      <Pressable
        onPress={async () => {
          const full = await attachmentDisplayUrl(att, false);
          if (full) onPress(full);
        }}
        className="h-24 w-24 overflow-hidden rounded-xl bg-slate-200"
      >
        {thumbUrl ? (
          <Image source={{ uri: thumbUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#94A3B8" />
          </View>
        )}
      </Pressable>
      {onDelete ? (
        <Pressable
          onPress={onDelete}
          hitSlop={8}
          className="absolute -right-1.5 -top-1.5 h-6 w-6 items-center justify-center rounded-full bg-ink"
        >
          <SymbolView name="xmark" tintColor="#FFFFFF" size={11} />
        </Pressable>
      ) : null}
    </View>
  );
}
