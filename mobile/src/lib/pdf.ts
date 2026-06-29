// Turn our in-app HTML preview (invoices / quotes) into a real PDF on-device and
// hand it to the OS share sheet. No server needed — expo-print renders the HTML
// to a PDF locally; we just rename it to something human before sharing.

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
// Legacy API: stable cacheDirectory/moveAsync/deleteAsync (the SDK 54+ root
// export dropped them for a new File/Paths API we don't need here).
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Render `html` to a PDF and return its file URI. Optionally opens the share
 * sheet. The file is renamed to `<fileName>.pdf` so it reads nicely when shared
 * or attached to an email.
 */
export async function htmlToPdf(html: string, fileName: string): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html });
  const safe = fileName.replace(/[^\w.-]+/g, '_').replace(/\.pdf$/i, '');
  const dest = `${FileSystem.cacheDirectory}${safe}.pdf`;
  try {
    // Clear any stale file with the same name, then rename the temp output.
    await FileSystem.deleteAsync(dest, { idempotent: true });
    await FileSystem.moveAsync({ from: uri, to: dest });
    return dest;
  } catch {
    return uri; // fall back to the temp uri if rename fails
  }
}

/** Render to PDF and immediately open the OS share sheet (Save to Files, AirDrop…). */
export async function shareHtmlAsPdf(html: string, fileName: string): Promise<void> {
  const uri = await htmlToPdf(html, fileName);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: fileName,
    });
  }
}
