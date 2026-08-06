import { useRef } from 'react';
import { Modal, Text, View } from 'react-native';
import Signature, { SignatureViewRef } from 'react-native-signature-canvas';

import { Button } from '@/components/ui/Button';
import { useTranslation } from '@/lib/i18n';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Receives the raw base64 (no data: prefix) of the signature PNG. */
  onSave: (base64Png: string) => void;
};

export function SignaturePad({ visible, onClose, onSave }: Props) {
  const ref = useRef<SignatureViewRef>(null);
  const { t } = useTranslation();

  const handleOK = (dataUrl: string) => {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    onSave(base64);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-white">
        <View className="px-5 pt-14 pb-2">
          <Text className="text-xl font-bold text-ink">{t.mobileUi.clientSignature}</Text>
          <Text className="text-sm text-ink-muted">{t.mobileUi.signatureHint}</Text>
        </View>

        {/* The canvas. Its own footer buttons are hidden (unreliable on device);
            we drive it with the native buttons below via the ref. */}
        <View className="flex-1">
          <Signature
            ref={ref}
            onOK={handleOK}
            onEmpty={() => {
              /* nothing drawn yet — keep the pad open so the client can sign */
            }}
            onError={onClose}
            descriptionText=""
            imageType="image/png"
            webStyle={`.m-signature-pad--footer { display: none; margin: 0; }
              .m-signature-pad { box-shadow: none; border: 1px solid #E2E8F0; }
              .m-signature-pad--body { border: none; }
              body,html { height: 100%; margin: 0; }`}
          />
        </View>

        {/* Native action buttons — always visible, reliable. */}
        <View className="gap-2 px-5 pb-10 pt-2">
          <Button title={t.mobileUi.confirmSignature} onPress={() => ref.current?.readSignature()} />
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button title={t.common.clear} variant="secondary" onPress={() => ref.current?.clearSignature()} />
            </View>
            <View className="flex-1">
              <Button title={t.common.cancel} variant="secondary" onPress={onClose} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
