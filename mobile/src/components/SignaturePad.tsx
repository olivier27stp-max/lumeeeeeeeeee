import { useRef } from 'react';
import { Modal, Text, View } from 'react-native';
import Signature, { SignatureViewRef } from 'react-native-signature-canvas';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Receives the raw base64 (no data: prefix) of the signature PNG. */
  onSave: (base64Png: string) => void;
};

export function SignaturePad({ visible, onClose, onSave }: Props) {
  const ref = useRef<SignatureViewRef>(null);

  const handleOK = (dataUrl: string) => {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    onSave(base64);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-white">
        <View className="px-5 pt-14 pb-2">
          <Text className="text-xl font-bold text-ink">Client signature</Text>
          <Text className="text-sm text-ink-muted">
            Ask the client to sign below to confirm the work.
          </Text>
        </View>
        <Signature
          ref={ref}
          onOK={handleOK}
          onEmpty={onClose}
          onError={onClose}
          descriptionText=""
          clearText="Clear"
          confirmText="Save"
          imageType="image/png"
          webStyle={`.m-signature-pad--footer { margin: 8px; }
            .m-signature-pad { box-shadow: none; border: 1px solid #E2E8F0; }
            body,html { height: 100%; }`}
        />
      </View>
    </Modal>
  );
}
