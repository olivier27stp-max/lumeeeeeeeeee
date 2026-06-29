import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  NoteFile,
  createSpecificNote,
  deleteSpecificNote,
  listSpecificNotes,
} from '@/lib/api/specificNotes';
import { capturePhoto, pickPhoto, uploadJobPhoto } from '@/lib/api/jobPhotos';
import { useAuth } from '@/lib/auth';

/** Running internal notes log for a job (text + photos). */
export function SpecificNotesCard({ jobId, orgId }: { jobId: string; orgId: string }) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const [text, setText] = useState('');
  const [pending, setPending] = useState<NoteFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const { data: notes, isLoading } = useQuery({
    queryKey: ['specific-notes', 'job', jobId],
    queryFn: () => listSpecificNotes('job', jobId),
    enabled: !!jobId,
  });

  const add = useMutation({
    mutationFn: () => {
      if (!text.trim() && pending.length === 0) throw new Error('Note vide.');
      return createSpecificNote({
        orgId,
        entityType: 'job',
        entityId: jobId,
        text,
        files: pending,
        createdBy: userId,
      });
    },
    onSuccess: () => {
      setText('');
      setPending([]);
      qc.invalidateQueries({ queryKey: ['specific-notes', 'job', jobId] });
    },
    onError: (e: Error) => Alert.alert('Note', e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteSpecificNote(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['specific-notes', 'job', jobId] }),
  });

  const attach = async (fromCamera: boolean) => {
    const img = fromCamera ? await capturePhoto() : await pickPhoto();
    if (!img) return;
    setUploading(true);
    try {
      const att = await uploadJobPhoto({ jobId, orgId, uri: img.uri, userId });
      setPending((p) => [...p, { name: att.name ?? 'photo', url: att.url, path: att.path, file_type: 'image' as const }]);
    } catch (e) {
      Alert.alert('Photo', (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <View className="gap-3 rounded-2xl bg-white p-4">
      <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">Notes internes</Text>

      {/* Composer */}
      <Input value={text} onChangeText={setText} placeholder="Ajouter une note…" multiline />
      {pending.length ? (
        <View className="flex-row flex-wrap gap-2">
          {pending.map((f, i) => (
            <Image key={i} source={{ uri: f.url }} className="h-14 w-14 rounded-lg" />
          ))}
        </View>
      ) : null}
      <View className="flex-row items-center gap-3">
        <Pressable onPress={() => attach(true)} className="flex-row items-center gap-1">
          <SymbolView name="camera" tintColor="#525252" size={16} />
          <Text className="text-sm text-ink-muted">Photo</Text>
        </Pressable>
        <Pressable onPress={() => attach(false)} className="flex-row items-center gap-1">
          <SymbolView name="photo" tintColor="#525252" size={16} />
          <Text className="text-sm text-ink-muted">Galerie</Text>
        </Pressable>
        {uploading ? <ActivityIndicator size="small" color="#171717" /> : null}
        <View className="flex-1" />
        <Button title="Ajouter" onPress={() => add.mutate()} loading={add.isPending} />
      </View>

      {/* Existing notes */}
      {isLoading ? (
        <ActivityIndicator color="#171717" />
      ) : (
        (notes ?? []).map((n) => (
          <View key={n.id} className="gap-1.5 border-t border-surface-border pt-3">
            {n.text ? <Text className="text-base text-ink">{n.text}</Text> : null}
            {n.files?.length ? (
              <View className="flex-row flex-wrap gap-2">
                {n.files.map((f, i) => (
                  <Image key={i} source={{ uri: f.url }} className="h-20 w-20 rounded-lg" />
                ))}
              </View>
            ) : null}
            <View className="flex-row items-center justify-between">
              <Text className="text-[11px] text-ink-subtle">{new Date(n.created_at).toLocaleString()}</Text>
              <Pressable onPress={() => del.mutate(n.id)} hitSlop={8}>
                <SymbolView name="trash" tintColor="#A3A3A3" size={14} />
              </Pressable>
            </View>
          </View>
        ))
      )}
    </View>
  );
}
