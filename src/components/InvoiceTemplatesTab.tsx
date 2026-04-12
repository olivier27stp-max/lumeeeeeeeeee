// DEPRECATED — Invoice template system removed.
// This stub exists to prevent import errors during transition.

import React from 'react';

interface Props {
  onUseTemplate: (template: any) => void;
}

export default function InvoiceTemplatesTab(_props: Props) {
  return (
    <div className="p-6 text-center text-text-tertiary text-sm">
      Invoice templates have been removed. Invoices now use a single standard layout.
    </div>
  );
}
