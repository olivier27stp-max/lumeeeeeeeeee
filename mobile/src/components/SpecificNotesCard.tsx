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
  updateSpecificNoteFiles,
} from '@/lib/api/specificNotes';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';

/** Running internal notes log for a job (text only — job photos live in the
 * separate Photos section, so notes don't duplicate that). */
export function SpecificNotesCard({ jobId, orgId }: { jobId: string; orgId: string }) {
  const { t } = useTranslation();
  const c = t.mobileComp;
  const qc = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const [text, setText] = useState('');

  const { data: notes, isLoading } = useQuery({
    queryKey: ['specific-notes', 'job', jobId],
    queryFn: () => listSpecificNotes('job', jobId),
    enabled: !!jobId,
  });

  const add = useMutation({
    mutationFn: () => {
      if (!text.trim()) throw new Error(c.noteEmpty);
      return createSpecificNote({
        orgId,
        entityType: 'job',
        entityId: jobId,
        text,
        files: [],
        createdBy: userId,
      });
    },
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['specific-notes', 'job', jobId] });
    },
    onError: (e: Error) => Alert.alert(c.note, e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteSpecificNote(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['specific-notes', 'job', jobId] }),
  });
  const confirmDelNote = (id: string) =>
    Alert.alert(c.deleteNoteTitle, c.deleteNoteConfirm, [
      { text: c.cancel, style: 'cancel' },
      { text: c.delete, style: 'destructive', onPress: () => del.mutate(id) },
    ]);

  // Remove one photo from an already-saved note (clean up legacy note photos).
  const removePhoto = useMutation({
    mutationFn: ({ noteId, files }: { noteId: string; files: NoteFile[] }) =>
      updateSpecificNoteFiles(noteId, files),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['specific-notes', 'job', jobId] }),
    onError: (e: Error) => Alert.alert(c.photo, e.message),
  });

  return (
    <View className="gap-3 rounded-2xl bg-white p-4">
      <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{c.internalNotes}</Text>

      {/* Composer (text only) */}
      <Input value={text} onChangeText={setText} placeholder={c.addNotePlaceholder} multiline />
      <View className="flex-row items-center">
        <View className="flex-1" />
        <Button title={c.add} onPress={() => add.mutate()} loading={add.isPending} />
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
                  <View key={i} className="relative">
                    <Image source={{ uri: f.url }} className="h-20 w-20 rounded-lg" />
                    <Pressable
                      onPress={() =>
                        removePhoto.mutate({ noteId: n.id, files: n.files.filter((_, idx) => idx !== i) })
                      }
                      hitSlop={8}
                      className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full bg-ink"
                    >
                      <SymbolView name="xmark" tintColor="#FFFFFF" size={10} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
            <View className="flex-row items-center justify-between">
              <Text className="text-[11px] text-ink-subtle">{new Date(n.created_at).toLocaleString()}</Text>
              <Pressable onPress={() => confirmDelNote(n.id)} hitSlop={8}>
                <SymbolView name="trash" tintColor="#A3A3A3" size={14} />
              </Pressable>
            </View>
          </View>
        ))
      )}
    </View>
  );
}
